import { isAbsolute, join, relative, resolve } from 'node:path';
import { PhdudeError } from '../domain/errors.js';
import { sha256 } from '../domain/hash.js';
import {
  bindTemplate,
  emptyRegistry,
  findTemplate,
  missingStyles,
  templateKind,
  templateName,
  templateTarget,
  upsertTemplate,
} from '../domain/templates.js';
import { assertUpToDate } from './guard.js';
import { assertPathsInsideRoot, outsideWorkspace } from './paths.js';

const CONFINED_HINT = 'a template is a file inside the workspace, e.g. under templates/';
const PROFILE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function readRegistry(store) {
  return (await store.readTemplates()) ?? emptyRegistry();
}

async function readTemplateBytes(readBytes, rel, hint) {
  try {
    return await readBytes(rel);
  } catch (err) {
    if (err.code === 'ENOENT') throw new PhdudeError('VALIDATION', `file not found: ${rel}`, hint);
    if (err.code === 'EISDIR') {
      throw new PhdudeError('VALIDATION', `not a file: ${rel}`, 'a template is one file');
    }
    throw err;
  }
}

// The real-path guard only speaks for a file that is already there, and a template PhDude has
// never seen may not be. A path that leaves the workspace on the way in is refused first.
function assertInsideWorkspace(root, path) {
  const back = relative(root, resolve(root, path));
  if (back === '' || back.startsWith('..') || isAbsolute(back)) {
    throw outsideWorkspace(path, CONFINED_HINT);
  }
}

function mustFind(registry, name) {
  const template = findTemplate(registry, name);
  if (!template) {
    throw new PhdudeError(
      'VALIDATION',
      `no template named ${name}`,
      'run phdude template list, or register it with phdude template add <path>',
    );
  }
  return template;
}

/**
 * @param {{store: object}} deps
 * @returns {Promise<object[]>}
 */
export async function list({ store }) {
  return (await readRegistry(store)).templates;
}

/**
 * Registers a document template: the file is copied under `templates/<kind>/` and recorded by
 * name, kind, path and hash. The name is the identity, so re-registering a changed file
 * corrects the entry in place and keeps the profile it was bound to; re-registering the same
 * bytes writes nothing and records nothing.
 * @param {{store: object, clock: () => string, actor: object,
 *   readBytes: (rel: string) => Promise<Buffer>,
 *   realpath: (path: string) => Promise<string>}} deps
 * @param {string} path - workspace-relative
 * @param {{kind?: string}} [opts]
 * @returns {Promise<{template: object, created: boolean, changed: boolean}>}
 */
export async function add({ store, clock, actor, readBytes, realpath }, path, { kind } = {}) {
  assertUpToDate(await store.readProject());

  assertInsideWorkspace(store.root, path);
  const name = templateName(path);
  const resolvedKind = templateKind(path, kind);
  const target = templateTarget(name, resolvedKind, path);
  await assertPathsInsideRoot({ realpath }, store.root, [path, target], CONFINED_HINT);

  const bytes = await readTemplateBytes(readBytes, path, 'put the template inside the workspace');
  const entry = { name, kind: resolvedKind, path: target, hash: sha256(bytes) };

  const registry = await readRegistry(store);
  const existing = findTemplate(registry, name);
  const onDisk = resolve(store.root, path) === resolve(store.root, target);
  if (
    existing &&
    existing.kind === entry.kind &&
    existing.path === entry.path &&
    existing.hash === entry.hash &&
    (onDisk || (await store.exists(target)))
  ) {
    return { template: existing, created: false, changed: false };
  }

  if (!onDisk) await store.writeBytesAtomic(target, bytes);
  await store.writeTemplates(upsertTemplate(registry, entry));

  const at = clock();
  await store.appendEvent({
    ts: at,
    op: 'template',
    actor,
    ids: [],
    summary: existing
      ? `template updated: ${name} (${resolvedKind}, ${target})`
      : `template registered: ${name} (${resolvedKind}, ${target})`,
  });
  return {
    template: findTemplate(await readRegistry(store), name),
    created: !existing,
    changed: true,
  };
}

/**
 * Binds a registered template to a publication profile, which is how a build and a presentation
 * know which one to hand the renderer.
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} name
 * @param {{profile: string}} opts
 * @returns {Promise<{template: object, changed: boolean}>}
 */
export async function use({ store, clock, actor }, name, { profile } = {}) {
  assertUpToDate(await store.readProject());
  if (!PROFILE_RE.test(String(profile ?? ''))) {
    throw new PhdudeError(
      'VALIDATION',
      `not a profile name: ${profile}`,
      'phdude template use <name> --for <profile>',
    );
  }

  const registry = await readRegistry(store);
  const existing = mustFind(registry, name);
  if (existing.for === profile) return { template: existing, changed: false };

  const updated = bindTemplate(registry, name, profile);
  await store.writeTemplates(updated);
  await store.appendEvent({
    ts: clock(),
    op: 'template',
    actor,
    ids: [],
    summary: `template bound: ${name} → ${profile}`,
  });
  return { template: findTemplate(updated, name), changed: true };
}

/**
 * Reports whether a DOCX template declares the styles Pandoc writes with, and whether the file
 * is still the one that was registered. It reads; it records nothing.
 * @param {{store: object, readBytes: (rel: string) => Promise<Buffer>,
 *   ooxmlStyles: (bytes: Buffer) => string[]}} deps
 * @param {string} name
 * @returns {Promise<{template: object, checked: boolean, ok: boolean, missing: string[],
 *   hashMatches: boolean, reason: string|null}>}
 */
export async function check({ store, readBytes, ooxmlStyles }, name) {
  const template = mustFind(await readRegistry(store), name);
  const bytes = await readTemplateBytes(
    readBytes,
    template.path,
    `${name} is registered but its file is gone; register it again with phdude template add`,
  );
  const hashMatches = sha256(bytes) === template.hash;

  // Only a DOCX carries the Word styles Pandoc writes into. Passing a PPTX or a LaTeX template
  // here would report a clean bill of health nothing checked.
  if (template.kind !== 'docx') {
    return {
      template,
      checked: false,
      ok: hashMatches,
      missing: [],
      hashMatches,
      reason: `a ${template.kind} template declares no Word styles to check`,
    };
  }

  const missing = missingStyles(ooxmlStyles(bytes));
  return {
    template,
    checked: true,
    ok: missing.length === 0 && hashMatches,
    missing,
    hashMatches,
    reason: null,
  };
}

export const REGISTRY_PATH = join('.phdude', 'templates.yaml');
