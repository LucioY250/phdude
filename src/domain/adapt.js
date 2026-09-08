// What moving a manuscript from one venue to another would cost (spec §3.5): which section
// becomes which, which ones no longer fit, which figures need another format, which words the
// target venue calls something else, and which citation style takes over. Pure: the caller reads
// the workspace, this decides what the plan is and what the adapted manuscript would look like.
//
// The plan never rewrites prose and never can: `adaptedManuscript` produces a second manuscript
// whose sections point at the same files, marking the ones that no longer fit as `revised`. The
// rewriting itself goes back through `phdude write` and `phdude deslop`, gates included.

import { slugify } from './manuscript.js';
import { orderedSections, sectionLimit } from './profiles.js';
import { stripMarkup, words } from './textstats.js';

const ABSTRACT = 'abstract';

/**
 * How many times a term appears as a word of its own. A term ending in a letter or a digit may
 * not be followed by one ("Figures" is not a hit for "Figure"); one ending in punctuation, like
 * `Fig.`, has no closing boundary to ask for.
 * @param {string} text
 * @param {string} term
 * @returns {number}
 */
function countTerm(text, term) {
  const needle = String(term ?? '');
  if (needle === '') return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const closing = /[\p{L}\p{N}]$/u.test(needle) ? '(?![\\p{L}\\p{N}])' : '';
  const matches = text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}${closing}`, 'gu'));
  return matches === null ? 0 : matches.length;
}

function wordCount(body) {
  return typeof body === 'string' ? words(body).length : null;
}

// The style a reader acts on ("APA 7th edition" becomes "IEEE"), not the `.csl` file the build
// hands Pandoc, which says which pack implements it rather than what changes.
function styleOf(profile) {
  const style = profile?.references?.style;
  if (typeof style === 'string' && style.trim() !== '') return style.trim();
  return typeof profile?.citation_style === 'string' ? profile.citation_style : null;
}

function matches(target, entry) {
  const title = slugify(entry.title);
  if (target.id === entry.id) return 'id';
  if ((target.synonyms ?? []).some((name) => slugify(name) === entry.id || slugify(name) === title))
    return 'synonym';
  if (slugify(target.title) === title || slugify(target.title) === entry.id) return 'title';
  return null;
}

/**
 * Which target section a manuscript section becomes. The venue's own word wins first: the same
 * id, then a synonym the venue declared, then a title the two share. A target section an earlier
 * manuscript section already took is not offered twice - two sections cannot become one, and
 * saying which one took it is more use than silently dropping the second.
 */
function mapSection(entry, targets, taken, venue) {
  const free = targets.filter((target) => !taken.has(target.id));
  for (const how of ['id', 'synonym', 'title']) {
    const found = free.find((target) => matches(target, entry) === how);
    if (found === undefined) continue;
    const reason =
      how === 'id'
        ? `${found.id} is the same section id`
        : how === 'synonym'
          ? `${venue} lists ${entry.id} as a synonym for ${found.id}`
          : `both are titled "${found.title}"`;
    return { to: found.id, reason };
  }

  const claimed = targets.find((target) => taken.has(target.id) && matches(target, entry) !== null);
  if (claimed !== undefined) {
    return {
      to: null,
      reason: `needs decision: ${claimed.id} is already taken by ${taken.get(claimed.id)}`,
    };
  }
  return { to: null, reason: `needs decision: ${venue} lists no section for ${entry.id}` };
}

/**
 * What adapting this manuscript to another venue would take (spec §3.5).
 *
 * @param {object} manuscript - the manuscript, whose `sections` give the structure
 * @param {{id: string, body: string|null}[]} sections - the prose that is on disk, by section id
 * @param {object|null} fromProfile - the venue the manuscript targets today
 * @param {object} toProfile - the venue it would go to
 * @param {{figures?: object[]}} [opts] - the declared figures, for the format rule
 * @returns {{mapping: {from: string|null, to: string|null, reason: string}[],
 *   limits: {section: string, words: number, max: number, delta: number}[],
 *   abstract: {section: string|null, words: number|null, from: number|null, to: number|null,
 *     delta: number|null},
 *   figures: {id: string, from: string, to: string}[],
 *   terminology: {from: string, to: string, hits: number}[],
 *   citation_style: {from: string|null, to: string|null}}}
 */
export function planAdaptation(
  manuscript,
  sections,
  fromProfile,
  toProfile,
  { figures = [] } = {},
) {
  const bodies = new Map((sections ?? []).map((section) => [section.id, section.body]));
  const entries = [...(manuscript?.sections ?? [])].sort((a, b) => a.order - b.order);
  const targets = orderedSections(toProfile);
  const venue = toProfile?.name ?? '(unnamed venue)';

  const taken = new Map();
  const mapping = [];
  for (const entry of entries) {
    const { to, reason } = mapSection(entry, targets, taken, venue);
    if (to !== null) taken.set(to, entry.id);
    mapping.push({ from: entry.id, to, reason });
  }

  for (const target of targets) {
    if (taken.has(target.id) || target.required === false) continue;
    mapping.push({
      from: null,
      to: target.id,
      reason: `${venue} requires ${target.id}; nothing in the manuscript maps to it`,
    });
  }

  // The abstract's limit is written once, under `abstract.max_words` (domain/profiles.js), so
  // reporting it among the sections too would state one rule twice.
  const limits = [];
  for (const row of mapping) {
    if (row.from === null || row.to === null || row.to === ABSTRACT) continue;
    const max = sectionLimit(
      toProfile,
      targets.find((target) => target.id === row.to),
    );
    const count = wordCount(bodies.get(row.from));
    if (max === null || count === null) continue;
    limits.push({ section: row.from, words: count, max, delta: count - max });
  }

  const abstractRow = mapping.find((row) => row.to === ABSTRACT && row.from !== null) ?? null;
  const abstractWords = abstractRow === null ? null : wordCount(bodies.get(abstractRow.from));
  const abstractMax = toProfile?.abstract?.max_words ?? null;

  const accepted = toProfile?.figures?.formats ?? [];
  const figurePlan = [];
  for (const figure of figures ?? []) {
    const formats = [...new Set((figure.outputs ?? []).map((output) => output.format))];
    if (accepted.length === 0 || formats.length === 0) continue;
    if (formats.some((format) => accepted.includes(format))) continue;
    figurePlan.push({ id: figure.id, from: formats.join(', '), to: accepted[0] });
  }

  const prose = [...bodies.values()]
    .filter((body) => typeof body === 'string')
    .map((body) => stripMarkup(body))
    .join('\n');
  const terminology = [];
  for (const [from, to] of Object.entries(toProfile?.writing?.terminology_map ?? {})) {
    const hits = countTerm(prose, from);
    if (hits > 0) terminology.push({ from, to, hits });
  }

  return {
    mapping,
    limits,
    abstract: {
      section: abstractRow?.from ?? null,
      words: abstractWords,
      from: fromProfile?.abstract?.max_words ?? null,
      to: abstractMax,
      delta: abstractWords === null || abstractMax === null ? null : abstractWords - abstractMax,
    },
    figures: figurePlan,
    terminology,
    citation_style: { from: styleOf(fromProfile), to: styleOf(toProfile) },
  };
}

/**
 * The manuscript this plan would write: the same prose files under the target venue's ids,
 * titles and order, with the sections that no longer fit marked `revised` so the writing
 * pipeline has to run over them again. A section the target has no place for is kept, after the
 * ones it named - refusing to carry it would lose a chapter, and `phdude profile check` reports
 * it as one the venue does not list.
 *
 * @param {object} manuscript
 * @param {object} plan - from `planAdaptation`
 * @param {object} toProfile
 * @returns {object} a manuscript per `schemas/manuscript.json`
 */
export function adaptedManuscript(manuscript, plan, toProfile) {
  const byId = new Map((manuscript?.sections ?? []).map((entry) => [entry.id, entry]));
  const targets = orderedSections(toProfile);
  const rank = new Map(targets.map((target, index) => [target.id, index]));
  const titles = new Map(targets.map((target) => [target.id, target.title]));

  const over = new Set(
    plan.limits.filter((limit) => limit.delta > 0).map((limit) => limit.section),
  );
  if (plan.abstract?.section !== null && plan.abstract?.delta > 0) over.add(plan.abstract.section);

  const rows = plan.mapping.filter((row) => row.from !== null && byId.has(row.from));
  const mapped = rows
    .filter((row) => row.to !== null)
    .sort((a, b) => rank.get(a.to) - rank.get(b.to))
    .map((row) => ({ entry: byId.get(row.from), id: row.to, title: titles.get(row.to) }));
  const kept = rows
    .filter((row) => row.to === null)
    .map((row) => ({ entry: byId.get(row.from), id: row.from, title: byId.get(row.from).title }));

  const sections = [...mapped, ...kept].map(({ entry, id, title }, index) => {
    // A section with no prose has nothing to cut, so a limit it cannot yet break cannot revise it.
    const revised = over.has(entry.id) && entry.status !== 'planned';
    const section = {
      id,
      title,
      file: entry.file,
      order: index + 1,
      status: revised ? 'revised' : entry.status,
      hash: entry.hash,
      claims: [...(entry.claims ?? [])],
      questions: [...(entry.questions ?? [])],
    };
    // An approval is for the text the venue it was approved under would take. A section this
    // venue sends back for revision no longer carries one.
    if (!revised && entry.approved_by !== undefined) section.approved_by = entry.approved_by;
    return section;
  });

  return {
    schema: manuscript.schema,
    version: manuscript.version,
    title: manuscript.title,
    language: manuscript.language,
    voice: manuscript.voice,
    target_profile: toProfile.name,
    ...(manuscript.date === undefined ? {} : { date: manuscript.date }),
    sections,
  };
}
