// The manuscript model (PRD §33, spec §3.1): the section list, the hash that drives
// incremental gate runs, the status transitions approval depends on, and the front matter
// PhDude writes at the top of every section file. Pure: no fs, no yaml, no clock.

import { sha256 } from './hash.js';

// `purpose` is what the writing context tells the agent the section is for (PRD §70, item 1).
// It is not persisted: `manuscript.yaml` carries the id, the title and the plan, and a purpose
// that lived in the file would drift from the one the pipeline uses.
export const STANDARD_SECTIONS = [
  {
    id: 'abstract',
    title: 'Abstract',
    purpose:
      'State the question, what was done, what was found and what it means, in one paragraph, with no citations.',
  },
  {
    id: 'introduction',
    title: 'Introduction',
    purpose:
      'Establish the problem, what is already known and where the gap is, and end on the research questions this work addresses.',
  },
  {
    id: 'methods',
    title: 'Methods',
    purpose:
      'Describe the design, the sample, the instruments and the analysis precisely enough for another researcher to repeat them.',
  },
  {
    id: 'results',
    title: 'Results',
    purpose:
      'Report what was found, in the order the questions were asked, without interpreting it.',
  },
  {
    id: 'discussion',
    title: 'Discussion',
    purpose:
      'Interpret the findings against the literature, name what the evidence cannot settle, and state the limitations.',
  },
  {
    id: 'conclusions',
    title: 'Conclusions',
    purpose: 'Answer the research questions at the strength the evidence supports, and no more.',
  },
];

/**
 * @param {string} id
 * @returns {string|null} what a standard section is for, or null for a section PhDude does not
 *   ship a purpose for (a researcher-added one)
 */
export function sectionPurpose(id) {
  return STANDARD_SECTIONS.find((section) => section.id === id)?.purpose ?? null;
}

export const SECTION_STATUSES = ['planned', 'draft', 'revised', 'approved'];

// `approved` has no outgoing transition on purpose: an approved section leaves that state only
// through `manuscript reopen`, which is an explicit act with its own event, never a side effect
// of submitting prose over it (PRD §3.4: approved manuscript text is human-authority ground).
export const SECTION_TRANSITIONS = {
  planned: ['draft'],
  draft: ['revised', 'approved'],
  revised: ['revised', 'approved'],
  approved: [],
};

export const SECTION_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// A decision may name a manuscript section as well as a knowledge object (spec §3.6): the
// section is not an entity, so it is addressed by this string form in `affects`.
export const MANUSCRIPT_AFFECTS_RE = /^manuscript:([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/**
 * @param {string} value
 * @returns {string|null} the section id in `manuscript:<section>`, or null for anything else
 */
export function manuscriptAffects(value) {
  return MANUSCRIPT_AFFECTS_RE.exec(String(value ?? ''))?.[1] ?? null;
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  return (SECTION_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * @param {string} text
 * @returns {string} lowercase ASCII, words joined by `-`; '' when nothing survives
 */
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// What the hash ignores is what a text editor changes without the researcher meaning anything
// by it: the line ending convention, trailing spaces on a line, and blank lines at the end of
// the file. Interior blank lines are paragraph boundaries, so they are prose and they count.
function normalizeBody(body) {
  return String(body ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\s+$/, '');
}

/**
 * @param {string} body - the section's Markdown, front matter excluded
 * @returns {string} sha256 of the normalized body
 */
export function sectionHash(body) {
  return sha256(normalizeBody(body));
}

/**
 * @param {{title: string, language?: string, voice?: {kind: string, author?: string}}} input
 * @returns {object} a manuscript with every standard section `planned` and no file written
 */
export function newManuscript({ title, language = 'en', voice = { kind: 'consensus' } }) {
  return {
    schema: 'phdude.manuscript',
    version: 1,
    title,
    language,
    voice,
    sections: STANDARD_SECTIONS.map((section, index) => ({
      id: section.id,
      title: section.title,
      file: `manuscript/${section.id}.md`,
      order: index + 1,
      status: 'planned',
      hash: null,
      claims: [],
      questions: [],
    })),
  };
}

const FRONT_MATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

// PhDude writes the front matter itself and it is four flat scalars, so this reads flat
// `key: value` lines and nothing else - no nesting, no lists, no block scalars. A hand-written
// key it cannot read is dropped rather than thrown on: the body is what the gates judge.
function parseFront(text) {
  const front = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2].trim().replace(/^["'](.*)["']$/, '$1');
    front[match[1]] = value === '' ? null : value;
  }
  return front;
}

/**
 * Splits a section file into its front matter and its body. A file with no front matter - the
 * draft an agent just wrote - is all body, and a resubmitted section's stale front matter is
 * lifted off rather than folded into the prose.
 * @param {string} text
 * @returns {{front: object, body: string}}
 */
export function parseSectionFile(text) {
  const source = String(text ?? '');
  const match = FRONT_MATTER_RE.exec(source);
  if (!match) return { front: {}, body: source };
  return {
    front: parseFront(match[1]),
    body: source.slice(match[0].length).replace(/^\r?\n/, ''),
  };
}

/**
 * @param {object} front - flat scalars; null and undefined values are left out
 * @param {string} body
 * @returns {string}
 */
export function renderSectionFile(front, body) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(front)) {
    if (value === null || value === undefined) continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push('---', '', '');
  return lines.join('\n') + normalizeBody(body) + '\n';
}
