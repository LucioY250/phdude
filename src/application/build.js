import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import {
  assemble,
  assetReferences,
  buildFormat,
  buildPaths,
  buildRecord,
  buildSlug,
  DEFAULT_PROFILE,
  planBuild,
  profileHash,
  selectSections,
} from '../domain/build.js';
import { PhdudeError } from '../domain/errors.js';
import { sha256 } from '../domain/hash.js';
import { driftNote, parseSectionFile, sectionDrift } from '../domain/manuscript.js';
import { rendererFor } from '../domain/renderers.js';
import { assertUpToDate } from './guard.js';
import { list as listAuthors } from './authors.js';
import { exportRegistry, registryText } from './cite.js';
import { loadManuscript } from './manuscript.js';
import { requireProfile } from './profile.js';

const TEMPLATES_PATH = join('.phdude', 'templates.yaml');
const AUTHOR_PROFILE_PATH = join('.phdude', 'author-profile.yaml');
const CONSENSUS_ID = 'project-consensus';

// The renderer kind a format renders through, which is also the kind of workspace template it
// can take. `md` takes none: the built-in renderer has no template support at all.
const TEMPLATE_KINDS = { latex: 'latex', pdf: 'latex', docx: 'docx', html: null, md: null };

/**
 * Who the document is by: the voice profiles under `authors/`, in id order, and the researcher
 * this workspace belongs to when there are none. `project-consensus` is a merged voice rather
 * than a person, so it is never a byline.
 * @returns {Promise<{name: string}[]>}
 */
async function bylineAuthors(store) {
  const profiles = (await listAuthors({ store })).filter(
    (profile) => profile?.id !== CONSENSUS_ID && typeof profile?.name === 'string',
  );
  if (profiles.length > 0) return profiles;

  const workspaceAuthor = await store.readYaml(AUTHOR_PROFILE_PATH);
  const name = typeof workspaceAuthor?.name === 'string' ? workspaceAuthor.name.trim() : '';
  return name === '' ? [] : [{ name }];
}

// A build's own `date` is a metadata value, not prose, so it comes from the manuscript or from
// the record of when the prose was approved - never from the clock (ADR 10).
function lastApprovalAt(events) {
  const approvals = events.filter(
    (event) => event?.op === 'manuscript' && String(event.summary ?? '').startsWith('approved '),
  );
  return approvals.at(-1)?.ts ?? null;
}

async function hashOf(store, relPath) {
  const bytes = await store.readBytes(relPath);
  return bytes === null ? null : sha256(bytes);
}

async function hashFile(absPath) {
  try {
    return sha256(await readFile(absPath));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * The template this build renders through: the workspace's own, when `phdude template use` bound
 * one to this venue, and the venue pack's otherwise. A workspace template is the researcher's
 * decision and outranks the one PhDude ships.
 * @returns {Promise<{path: string, rel: string|null, hash: string|null}|null>}
 */
async function templateFor(store, profile, format) {
  const kind = TEMPLATE_KINDS[format];
  if (kind === null) return null;

  const registry = await store.readYaml(TEMPLATES_PATH);
  const bound = (registry?.templates ?? []).find(
    (entry) => entry?.kind === kind && entry?.for === profile?.name,
  );
  if (bound && typeof bound.path === 'string') {
    return {
      path: join(store.root, bound.path),
      rel: bound.path,
      hash: await hashOf(store, bound.path),
    };
  }

  const packed = profile?.templatePaths?.[kind] ?? null;
  if (packed === null) return null;
  return { path: packed, rel: null, hash: await hashFile(packed) };
}

// Where a figure ends up beside the document, and whether it has to be converted to get there.
// A venue that names no figure formats takes what the prose already points at.
function figurePlan(profile, relPath) {
  const accepted = profile?.figures?.formats ?? [];
  const extension = extname(relPath).slice(1).toLowerCase();
  const name = basename(relPath, extname(relPath));
  const convert = extension === 'svg' && accepted.length > 0 && !accepted.includes('svg');
  return {
    convert,
    file: convert ? `${name}.pdf` : basename(relPath),
    accepted,
  };
}

async function resolveFigures({ store, svgConvert }, profile, paths, references) {
  const inputs = {};
  const links = new Map();
  const copies = [];
  const warnings = [];

  // Probed at most once, and only when a figure would actually need converting: a build of prose
  // with no SVG in it must not spawn a process to ask about one.
  const converter = svgConvert ?? null;
  let probe = null;
  const canConvert = async () => {
    if (converter === null) return false;
    probe ??= converter.available();
    return (await probe).ok;
  };

  for (const rel of references) {
    const hash = await hashOf(store, rel);
    if (hash === null) {
      warnings.push(`${rel} is not on disk; the reference was left as the prose wrote it`);
      continue;
    }
    inputs[rel] = hash;

    const plan = figurePlan(profile, rel);
    if (plan.convert && !(await canConvert())) {
      warnings.push(
        `${rel} was copied as SVG: ${profile.name} takes ${plan.accepted.join(', ')}, and ` +
          `${converter === null ? 'no SVG converter is configured' : converter.hint}`,
      );
      const file = basename(rel);
      links.set(rel, `figures/${file}`);
      copies.push({ from: rel, to: `${paths.figures}/${file}`, convert: false });
      continue;
    }

    links.set(rel, `figures/${plan.file}`);
    copies.push({ from: rel, to: `${paths.figures}/${plan.file}`, convert: plan.convert });
  }

  return { inputs, links, copies, warnings };
}

async function resolveTables(store, references) {
  const inputs = {};
  const includes = new Map();
  const warnings = [];

  for (const rel of references) {
    const text = await store.readText(rel);
    if (text === null) {
      warnings.push(`${rel} is not on disk; the reference was left as the prose wrote it`);
      continue;
    }
    inputs[rel] = sha256(text);
    includes.set(rel, text);
  }

  return { inputs, includes, warnings };
}

// A cache record nobody can read is a build that has not been made, not an error: the file is
// disposable by construction, and refusing to build over it would leave no way out but deleting
// it by hand.
async function readRecord(store, relPath) {
  const text = await store.readText(relPath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readSections(store, chosen) {
  const sections = [];
  for (const entry of chosen) {
    const text = await store.readSection(entry.file);
    if (text === null) {
      throw new PhdudeError(
        'VALIDATION',
        `section ${entry.id} is ${entry.status} but ${entry.file} is not on disk`,
        `phdude write ${entry.id}, or reopen the section`,
      );
    }
    const body = parseSectionFile(text).body;
    sections.push({ ...entry, body, drifted: sectionDrift(entry, body).drifted });
  }
  return sections;
}

/**
 * Builds the manuscript into one file, incrementally and reproducibly (spec §3.3).
 *
 * The order is the point: everything the document depends on is read and hashed first, the plan
 * compares that against the last build's record, and only then is anything written. A build with
 * nothing to do renders nothing, writes nothing and records nothing - which is what makes
 * running it twice a cheap way to ask whether the deliverable is current.
 *
 * @param {{store: object, clock: () => string, actor: object, renderers: object[],
 *   loadProfile: (name: string) => Promise<object|null>, svgConvert?: object}} deps
 * @param {{format?: string, profile?: string, sections?: string[], force?: boolean,
 *   includeDrafts?: boolean}} [opts]
 * @returns {Promise<object>}
 */
export async function build(deps, opts = {}) {
  const { store, clock, actor, renderers, loadProfile, svgConvert } = deps;
  const { sections: only = null, force = false, includeDrafts = false } = opts;

  const project = await store.readProject();
  if (project === null) {
    throw new PhdudeError('USAGE', 'not a PhDude workspace', 'run phdude init');
  }
  assertUpToDate(project);

  const format = buildFormat(opts.format);
  const manuscript = await loadManuscript(store);
  const profileName = opts.profile ?? manuscript.target_profile ?? DEFAULT_PROFILE;
  const profile = await requireProfile({ loadProfile }, profileName);

  const renderer = rendererFor(renderers, format);
  if (renderer === null) {
    throw new PhdudeError(
      'VALIDATION',
      `no renderer for format: ${format}`,
      'phdude doctor lists the renderers this install has',
    );
  }
  // Probed before anything is assembled: a build that cannot render is a build that should say
  // what to install, not one that leaves half a document behind.
  const availability = await renderer.available();
  if (!availability.ok) {
    throw new PhdudeError(
      'TOOL_MISSING',
      `${renderer.name} is not available, and ${format} needs it`,
      availability.hint,
    );
  }
  const rendererVersion = `${renderer.name} ${availability.version ?? 'unknown'}`;

  const chosen = selectSections(manuscript, profile, { includeDrafts, only });
  if (chosen.length === 0) {
    throw new PhdudeError(
      'VALIDATION',
      includeDrafts
        ? 'the manuscript has no written sections to build'
        : 'the manuscript has no approved sections to build',
      includeDrafts
        ? 'phdude write <section> to start one'
        : 'phdude manuscript approve <section>, or build with --include-drafts',
    );
  }

  const slug = buildSlug(manuscript);
  const paths = buildPaths(slug, format);
  const sections = await readSections(store, chosen);

  const references = assetReferences(sections.map((section) => section.body).join('\n\n'));
  const figures = await resolveFigures({ store, svgConvert }, profile, paths, references.figures);
  const tables = await resolveTables(store, references.tables);

  const assembled = assemble(
    {
      project,
      authors: await bylineAuthors(store),
      approvedAt: lastApprovalAt(await store.readEvents()),
    },
    manuscript,
    sections,
    profile,
    { includeDrafts, figures: figures.links, tables: tables.includes },
  );

  const bib = await registryText({ store, format: 'bibtex' });
  const template = await templateFor(store, profile, format);
  // The built-in Markdown renderer has one fixed citation style by design (ADR 10), so handing
  // it the venue's CSL would warn on every default build about something the build asked for.
  const cslPath = format === 'md' ? null : profile.cslPath;
  const cslHash = cslPath === null ? null : await hashFile(cslPath);

  const inputs = {
    ...assembled.inputs,
    ...figures.inputs,
    ...tables.inputs,
    [paths.bib]: sha256(bib.text),
    format,
    profile: `${profile.name} ${profileHash(profile)}`,
    renderer: rendererVersion,
    'include-drafts': String(includeDrafts),
    sections: chosen.map((section) => section.id).join(','),
  };
  if (cslHash !== null) inputs.csl = cslHash;
  if (template?.hash)
    inputs.template = `${template.rel ?? basename(template.path)} ${template.hash}`;

  const record = await readRecord(store, paths.record);
  const onDisk = { path: paths.document, hash: await hashOf(store, paths.document) };
  const plan = planBuild(record, inputs, rendererVersion, onDisk);
  const warnings = [
    ...sections.filter((section) => section.drifted).map((section) => driftNote(section.id)),
    ...figures.warnings,
    ...tables.warnings,
  ];

  if (plan.upToDate && !force) {
    return {
      slug,
      format,
      profile: profile.name,
      built: false,
      reason: 'up to date',
      changed: [],
      renderer: rendererVersion,
      sections: chosen.map((section) => section.id),
      output: { path: paths.document, hash: onDisk.hash },
      bib: paths.bib,
      figures: [...figures.links.values()],
      warnings,
    };
  }

  // The renderer runs with the output directory as its working directory, so relative figure
  // links resolve from the document. An external tool will not create it, and neither will
  // spawning one into a directory that is not there.
  await store.ensureDir(paths.dir);
  await store.writeTextAtomic(paths.source, assembled.markdown);
  await exportRegistry({ store, format: 'bibtex', path: paths.bib });
  for (const copy of figures.copies) {
    if (copy.convert) {
      await store.ensureDir(paths.figures);
      await svgConvert.convert({
        from: join(store.root, copy.from),
        to: join(store.root, copy.to),
      });
    } else {
      await store.writeBytesAtomic(copy.to, await store.readBytes(copy.from));
    }
  }

  const rendered = await renderer.render({
    input: {
      markdownPath: join(store.root, paths.source),
      bibPath: join(store.root, paths.bib),
      cslPath: cslPath ?? undefined,
      referenceDoc: template && TEMPLATE_KINDS[format] === 'docx' ? template.path : undefined,
      template: template && TEMPLATE_KINDS[format] === 'latex' ? template.path : undefined,
      metadata: assembled.metadata,
    },
    output: { path: join(store.root, paths.document), format },
    cwd: join(store.root, paths.dir),
  });
  warnings.push(...(rendered.warnings ?? []));

  const hash = await hashOf(store, paths.document);
  const at = clock();
  await store.writeTextAtomic(
    paths.record,
    JSON.stringify(
      buildRecord({
        format,
        profile: profile.name,
        renderer: renderer.name,
        rendererVersion,
        at,
        inputs,
        output: { path: paths.document, hash },
      }),
      null,
      2,
    ) + '\n',
  );

  await store.appendEvent({
    ts: at,
    op: 'build',
    actor,
    ids: [],
    summary: `manuscript built: ${paths.document} (${format}, ${profile.name}) ${hash}`,
  });

  return {
    slug,
    format,
    profile: profile.name,
    built: true,
    reason: null,
    changed: plan.changed,
    renderer: rendererVersion,
    sections: chosen.map((section) => section.id),
    output: { path: paths.document, hash },
    bib: paths.bib,
    figures: [...figures.links.values()],
    warnings,
  };
}
