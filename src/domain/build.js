// Assembling a manuscript into the file a supervisor, a conference or a co-author asked for
// (spec §3.3): which sections go in, in which order, under which headings, what the front matter
// says, which figures and tables the prose reaches for, and whether any of it has moved since the
// last build. Pure: the caller reads the workspace, this decides what the document is.
//
// The incremental rule lives here too, as a comparison of two maps of strings. Everything a build
// depends on - a section body, the bibliography, a figure's bytes, the venue profile, the
// template, the renderer's version - is reduced to one entry in that map, so "nothing changed"
// is a set difference rather than a list of special cases.

import { PhdudeError } from './errors.js';
import { sha256 } from './hash.js';
import { sectionHash, slugify } from './manuscript.js';
import { stableStringify } from './normalize.js';
import { orderedSections } from './profiles.js';

export const BUILD_FORMATS = ['md', 'docx', 'html', 'latex', 'pdf'];
export const DEFAULT_FORMAT = 'md';
export const DEFAULT_PROFILE = 'generic-thesis';

// What each format is called on disk. Everything else about a format is the renderer's business.
const EXTENSIONS = { md: 'md', docx: 'docx', html: 'html', latex: 'tex', pdf: 'pdf' };

// The abstract is metadata, not a chapter: every venue template PhDude ships sets it with
// `$abstract$` above the first heading, and a build that also emitted it as a section would
// print it twice.
const ABSTRACT = 'abstract';

// The statuses a build takes prose from. `planned` has no file at all; `draft` and `revised` are
// prose the researcher has not approved, so they are opt-in.
const APPROVED = ['approved'];
const WITH_DRAFTS = ['approved', 'revised', 'draft'];

const FIGURE_DIR = 'figures/out/';
const TABLE_DIR = 'tables/out/';

// `![alt](figures/out/x.svg)` and `[Table 1](tables/out/y.md)`: the two shapes prose uses to
// reach a built artifact. A title after the path (`(path "caption")`) is kept as written.
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)((?:\s+[^)]*)?)\)/g;
const WHOLE_LINK_RE = /^\[([^\]]*)\]\(([^)\s]+)((?:\s+[^)]*)?)\)$/;

/**
 * @param {string|null|undefined} format
 * @returns {string} the format, validated
 */
export function buildFormat(format) {
  if (format === undefined || format === null || format === '') return DEFAULT_FORMAT;
  const wanted = String(format).trim();
  if (!BUILD_FORMATS.includes(wanted)) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown build format: ${format}`,
      `formats are ${BUILD_FORMATS.join(', ')}`,
    );
  }
  return wanted;
}

/**
 * @param {string} format
 * @returns {string} the extension the built file carries
 */
export function extensionFor(format) {
  return EXTENSIONS[buildFormat(format)];
}

/**
 * The directory a build writes into, named after the manuscript so two manuscripts in one
 * workspace do not overwrite each other.
 * @param {object|null} manuscript
 * @returns {string}
 */
export function buildSlug(manuscript) {
  return slugify(manuscript?.title ?? '') || 'manuscript';
}

/**
 * Every path a build reads or writes, from the slug and the format alone.
 * @param {string} slug
 * @param {string} format
 * @returns {{dir: string, document: string, bib: string, figures: string, source: string,
 *   record: string}} workspace-relative
 */
export function buildPaths(slug, format) {
  const fmt = buildFormat(format);
  const cache = `.phdude/cache/build/${slug}`;
  return {
    dir: `outputs/${slug}`,
    document: `outputs/${slug}/manuscript.${EXTENSIONS[fmt]}`,
    bib: `outputs/${slug}/references.bib`,
    figures: `outputs/${slug}/figures`,
    source: `${cache}/${fmt}.md`,
    record: `${cache}/${fmt}.json`,
  };
}

/**
 * The sections this build is made of, in the order the venue puts them. A section the venue does
 * not list still goes in - a manuscript is not refused for having a chapter its venue never
 * heard of - but it goes in after the ones the venue named, in manuscript order.
 *
 * @param {object} manuscript
 * @param {object|null} profile
 * @param {{includeDrafts?: boolean, only?: string[]|null}} [opts]
 * @returns {{id: string, title: string, file: string, status: string, order: number}[]}
 */
export function selectSections(manuscript, profile, { includeDrafts = false, only = null } = {}) {
  const entries = [...(manuscript?.sections ?? [])].sort((a, b) => a.order - b.order);
  const eligible = includeDrafts ? WITH_DRAFTS : APPROVED;
  const wanted = Array.isArray(only) && only.length > 0 ? only : null;

  if (wanted) {
    for (const id of wanted) {
      const entry = entries.find((section) => section.id === id);
      if (!entry) {
        throw new PhdudeError(
          'VALIDATION',
          `the manuscript has no section "${id}"`,
          `sections: ${entries.map((section) => section.id).join(', ') || '(none)'}`,
        );
      }
      if (!eligible.includes(entry.status)) {
        throw new PhdudeError(
          'VALIDATION',
          `section ${id} is ${entry.status}, and a build takes ${eligible.join(' or ')} prose`,
          entry.status === 'planned'
            ? `phdude write ${id} to start it`
            : 'approve it, or build with --include-drafts',
        );
      }
    }
  }

  const chosen = entries.filter(
    (entry) => eligible.includes(entry.status) && (!wanted || wanted.includes(entry.id)),
  );

  const venue = orderedSections(profile).map((section) => section.id);
  const titles = new Map(orderedSections(profile).map((section) => [section.id, section.title]));

  return [...chosen]
    .map((entry, index) => ({
      entry,
      at: venue.includes(entry.id) ? venue.indexOf(entry.id) : venue.length + index,
    }))
    .sort((a, b) => a.at - b.at)
    .map(({ entry }) => ({
      id: entry.id,
      title: titles.get(entry.id) ?? entry.title,
      file: entry.file,
      status: entry.status,
      order: entry.order,
    }));
}

/**
 * The date the document carries. A build has to produce the same bytes tomorrow as today, so it
 * never reads a clock: the manuscript's own `date` first, then the last approval the workspace
 * recorded, and a document with neither simply carries no date.
 * @param {object|null} manuscript
 * @param {string|null} approvedAt - the ts of the last approval event
 * @returns {string|null} `YYYY-MM-DD`
 */
export function buildDate(manuscript, approvedAt = null) {
  const source = manuscript?.date ?? approvedAt;
  if (typeof source !== 'string' || source === '') return null;
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(source);
  return day ? day[1] : null;
}

/**
 * Every built artifact the prose points at: images under `figures/out/` and table links under
 * `tables/out/`. A link that reaches anywhere else is prose, not a reference, and is left alone.
 * @param {string} markdown
 * @returns {{figures: string[], tables: string[]}} workspace-relative paths, deduplicated,
 *   in the order the prose reaches them
 */
export function assetReferences(markdown) {
  const source = String(markdown ?? '');
  const figures = [];
  const tables = [];

  for (const match of source.matchAll(IMAGE_RE)) {
    if (assetUnder(match[2], FIGURE_DIR) && !figures.includes(match[2])) figures.push(match[2]);
  }
  // A table is included by a link on a line of its own; a link inside a sentence is a reference
  // to the file, and replacing it with a whole table would break the paragraph around it.
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    const match = WHOLE_LINK_RE.exec(trimmed);
    if (match && assetUnder(match[2], TABLE_DIR) && !tables.includes(match[2])) {
      tables.push(match[2]);
    }
  }

  return { figures, tables };
}

// A reference is a plain relative path that stays under its output directory: a `..` segment,
// an absolute path or a URL is prose about a file, never a file the build reads.
function assetUnder(path, dir) {
  if (!path.startsWith(dir) || path.length === dir.length) return false;
  const segments = path.split('/');
  return !segments.some((segment) => segment === '..' || segment === '' || segment === '.');
}

function rewriteAssets(markdown, { figures = new Map(), tables = new Map() } = {}) {
  const withFigures = markdown.replace(IMAGE_RE, (whole, alt, path, tail) => {
    const target = figures.get(path);
    return target === undefined ? whole : `![${alt}](${target}${tail})`;
  });

  return withFigures
    .split('\n')
    .map((line) => {
      const match = WHOLE_LINK_RE.exec(line.trim());
      if (!match) return line;
      const table = tables.get(match[2]);
      return table === undefined ? line : table.replace(/\s+$/, '');
    })
    .join('\n');
}

function metadataFor({ project, authors }, manuscript, { abstract, date, includeDrafts }) {
  const metadata = { title: manuscript?.title ?? project?.title ?? 'Untitled' };

  const names = authors
    .map((author) => (typeof author?.name === 'string' ? author.name.trim() : ''))
    .filter(Boolean);
  if (names.length > 0) metadata.author = names;

  if (date !== null) metadata.date = date;
  if (abstract !== null) metadata.abstract = abstract;
  // A document built from prose nobody has approved says so on its own front page, or a draft
  // travels as if it were the finished thing.
  if (includeDrafts) metadata.draft = true;
  return metadata;
}

/**
 * The document, as Markdown, plus the front matter the renderer will put on it. The renderer
 * owns the metadata (ADR 10), so the body starts at the first section heading and the title,
 * authors, date and abstract are handed over separately rather than written into the prose.
 *
 * @param {{project: object|null, authors: object[], approvedAt?: string|null}} snapshot
 * @param {object} manuscript
 * @param {{id: string, title: string, file: string, body: string}[]} sections - in build order,
 *   bodies with their front matter already lifted off
 * @param {object|null} profile
 * @param {{includeDrafts?: boolean, figures?: Map<string, string>, tables?: Map<string, string>}}
 *   [opts]
 * @returns {{markdown: string, metadata: object, inputs: Record<string, string>}}
 */
export function assemble(snapshot, manuscript, sections, profile, opts = {}) {
  const { includeDrafts = false, figures = new Map(), tables = new Map() } = opts;

  const inputs = {};
  const blocks = [];
  let abstract = null;

  for (const section of sections) {
    const body = rewriteAssets(String(section.body ?? '').trim(), { figures, tables });
    inputs[section.file] = sectionHash(section.body ?? '');
    if (section.id === ABSTRACT) {
      abstract = body;
      continue;
    }
    blocks.push(`# ${section.title}\n\n${body}\n`);
  }

  return {
    markdown: blocks.join('\n'),
    metadata: metadataFor(snapshot, manuscript, {
      abstract,
      date: buildDate(manuscript, snapshot?.approvedAt ?? null),
      includeDrafts,
    }),
    inputs,
  };
}

/**
 * What a venue profile contributes to a build, as one hash. The resolved absolute paths are left
 * out: they say where PhDude is installed, not what the venue asks for, and a workspace moved to
 * another machine would otherwise rebuild everything.
 * @param {object|null} profile
 * @returns {string}
 */
const RESOLVED_KEYS = ['dir', 'cslPath', 'templatePaths'];

export function profileHash(profile) {
  if (!profile) return sha256('(no profile)');
  const declared = Object.fromEntries(
    Object.entries(profile).filter(([key]) => !RESOLVED_KEYS.includes(key)),
  );
  return sha256(stableStringify(declared));
}

/**
 * Whether this build has already been made, and what moved if it has not. Both the inputs and the
 * record are flat maps of strings, so a section that changed, a figure that was rebuilt, a
 * template that was edited and a Pandoc upgrade are all the same kind of finding.
 *
 * @param {object|null} record - the cache record of the last build, or null
 * @param {Record<string, string>} inputs - every input of this build
 * @param {string} rendererVersion - `<name> <version>`, part of the record since ADR 10
 * @param {{path: string, hash: string|null}} [output] - the built file as it is on disk now
 * @returns {{upToDate: boolean, changed: string[]}} `changed` sorted, empty when up to date
 */
export function planBuild(record, inputs, rendererVersion, output = null) {
  if (record === null || typeof record !== 'object') return { upToDate: false, changed: ['*'] };

  const recorded = record.inputs ?? {};
  const changed = new Set();
  for (const key of Object.keys(inputs)) {
    if (recorded[key] !== inputs[key]) changed.add(key);
  }
  for (const key of Object.keys(recorded)) {
    if (!Object.hasOwn(inputs, key)) changed.add(key);
  }
  if (record.renderer_version !== rendererVersion) changed.add('renderer');

  // The record is a claim about a file. A build whose output was deleted, or overwritten by
  // something else, has not been made, however unchanged its inputs are.
  if (output !== null) {
    if (output.hash === null) changed.add('output');
    else if (record.output?.hash !== output.hash) changed.add('output');
  }

  return { upToDate: changed.size === 0, changed: [...changed].sort() };
}

/**
 * @param {{format: string, profile: string|null, renderer: string, rendererVersion: string,
 *   at: string, inputs: Record<string, string>, output: {path: string, hash: string}}} fields
 * @returns {object} the record written to `.phdude/cache/build/<slug>/<format>.json`
 */
export function buildRecord({ format, profile, renderer, rendererVersion, at, inputs, output }) {
  return {
    schema: 'phdude.build-cache',
    version: 1,
    format,
    profile,
    renderer,
    renderer_version: rendererVersion,
    at,
    inputs,
    output,
  };
}
