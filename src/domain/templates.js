// The templates registry (spec §3.6): which document templates the workspace holds, what kind
// of renderer each one is for, and which publication profile it belongs to. Pure: the bytes are
// copied and hashed by the application, and everything decided about a template is decided here.

import { PhdudeError } from './errors.js';
import { slugify } from './manuscript.js';

export const TEMPLATE_KINDS = ['docx', 'pptx', 'latex'];

const KIND_EXTENSIONS = { docx: ['.docx'], pptx: ['.pptx'], latex: ['.tex', '.latex'] };
const TEMPLATES_DIR = 'templates';

// What Pandoc writes with when it renders a manuscript into a DOCX template: the three heading
// levels a paper uses, the body style and the caption style. A template missing one of them
// silently loses that formatting, so `template check` names it before a build does.
export const REQUIRED_DOCX_STYLES = ['Heading 1', 'Heading 2', 'Heading 3', 'Body Text', 'Caption'];

export const REGISTRY_SCHEMA = 'phdude.templates';

function extensionOf(path) {
  const base = String(path ?? '').replace(/\\/g, '/');
  const name = base.slice(base.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/**
 * @param {string} path
 * @returns {string} the slug the template is registered under
 */
export function templateName(path) {
  const base = String(path ?? '').replace(/\\/g, '/');
  const file = base.slice(base.lastIndexOf('/') + 1);
  const name = slugify(file.slice(0, file.length - extensionOf(file).length));
  if (name === '') {
    throw new PhdudeError(
      'VALIDATION',
      `cannot name a template after ${path}`,
      'rename the file to letters and digits, e.g. thesis-template.docx',
    );
  }
  return name;
}

/**
 * @param {string} path
 * @param {string} [kind] - what the researcher said it is
 * @returns {'docx'|'pptx'|'latex'}
 */
export function templateKind(path, kind) {
  const extension = extensionOf(path);
  const inferred = TEMPLATE_KINDS.find((k) => KIND_EXTENSIONS[k].includes(extension)) ?? null;

  if (kind === undefined || kind === null) {
    if (inferred === null) {
      throw new PhdudeError(
        'VALIDATION',
        `not a template PhDude can register: ${path}`,
        `a template is ${TEMPLATE_KINDS.map((k) => KIND_EXTENSIONS[k].join('/')).join(', ')}`,
      );
    }
    return inferred;
  }

  if (!TEMPLATE_KINDS.includes(kind)) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown template kind: ${kind}`,
      `kinds are ${TEMPLATE_KINDS.join(', ')}`,
    );
  }
  if (!KIND_EXTENSIONS[kind].includes(extension)) {
    throw new PhdudeError(
      'VALIDATION',
      `${path} is not a ${kind} template`,
      `a ${kind} template ends in ${KIND_EXTENSIONS[kind].join(' or ')}`,
    );
  }
  return kind;
}

/**
 * @param {string} name
 * @param {string} kind
 * @param {string} sourcePath
 * @returns {string} where the registry keeps the copy, workspace-relative
 */
export function templateTarget(name, kind, sourcePath) {
  return `${TEMPLATES_DIR}/${kind}/${name}${extensionOf(sourcePath)}`;
}

/**
 * @returns {{schema: string, version: number, templates: object[]}}
 */
export function emptyRegistry() {
  return { schema: REGISTRY_SCHEMA, version: 1, templates: [] };
}

/**
 * @param {object} registry
 * @param {string} name
 * @returns {object|null}
 */
export function findTemplate(registry, name) {
  return (registry?.templates ?? []).find((t) => t.name === name) ?? null;
}

/**
 * Registering a name that is already there replaces what the file is, and only that: the
 * profile the researcher bound it to is a separate decision and survives a re-registration.
 * @param {object} registry
 * @param {{name: string, kind: string, path: string, hash: string}} entry
 * @returns {object} a new registry
 */
export function upsertTemplate(registry, entry) {
  const existing = findTemplate(registry, entry.name);
  const merged = existing?.for ? { ...entry, for: existing.for } : entry;
  const templates = existing
    ? registry.templates.map((t) => (t.name === entry.name ? merged : t))
    : [...(registry?.templates ?? []), merged];
  return { ...emptyRegistry(), ...registry, templates };
}

/**
 * @param {object} registry
 * @param {string} name
 * @param {string} profile
 * @returns {object} a new registry
 */
export function bindTemplate(registry, name, profile) {
  if (!findTemplate(registry, name)) {
    throw new PhdudeError(
      'VALIDATION',
      `no template named ${name}`,
      'run phdude template list, or register it with phdude template add <path>',
    );
  }
  return {
    ...registry,
    templates: registry.templates.map((t) => (t.name === name ? { ...t, for: profile } : t)),
  };
}

/**
 * The template a render should use: the one bound to the profile, or the only one of its kind
 * when nothing is bound. Two unbound candidates are no answer at all - choosing between them
 * would be PhDude deciding which template the researcher meant.
 * @param {object} registry
 * @param {{kind: string, profile?: string|null}} want
 * @returns {object|null}
 */
export function templateFor(registry, { kind, profile = null }) {
  const candidates = (registry?.templates ?? []).filter((t) => t.kind === kind);
  const bound = profile === null ? null : (candidates.find((t) => t.for === profile) ?? null);
  if (bound) return bound;
  const unbound = candidates.filter((t) => t.for === undefined || t.for === null);
  return unbound.length === 1 ? unbound[0] : null;
}

function styleKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * @param {string[]} styles - every style id and style name the template declares
 * @returns {string[]} the required styles it does not define, in the order they are required
 */
export function missingStyles(styles) {
  const have = new Set((styles ?? []).map(styleKey));
  return REQUIRED_DOCX_STYLES.filter((required) => !have.has(styleKey(required)));
}
