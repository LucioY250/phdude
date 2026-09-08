// What a venue asks of a manuscript, checked against what the manuscript is (spec §3.2). Pure:
// the caller hands over the manuscript, the section bodies it read and the profile the loader
// validated, and gets located findings back. Nothing here decides what to do about a block -
// `phdude profile check` exits 2 on one, and `gate-profile` refuses the submit.
//
// `gate-profile` sees one section at a time and `profile check` sees all of them, so the
// per-section rules live in `checkSection` and both go through it. That is the only way the two
// reports can agree about the same section. Where the venue puts a section is not one of them: it
// is a fact about the manuscript as a whole, and only `checkProfile` can see it.

import { words } from './textstats.js';

const ABSTRACT = 'abstract';

/**
 * @param {object} profile
 * @returns {object[]} the venue's sections in the order it declares, array position as the
 *   fallback for a profile written without `order`
 */
export function orderedSections(profile) {
  const sections = Array.isArray(profile?.sections) ? profile.sections : [];
  return sections
    .map((section, index) => ({
      section,
      at: Number.isInteger(section?.order) ? section.order : index + 1,
    }))
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.section);
}

/**
 * The abstract's limit is written once, under `abstract.max_words`, and the abstract section
 * inherits it; a section that states its own `max_words` keeps it.
 * @param {object} profile
 * @param {object} entry - a venue section
 * @returns {number|null}
 */
export function sectionLimit(profile, entry) {
  if (Number.isInteger(entry?.max_words)) return entry.max_words;
  if (entry?.id === ABSTRACT && Number.isInteger(profile?.abstract?.max_words)) {
    return profile.abstract.max_words;
  }
  return null;
}

function finding(severity, code, message, hint = null) {
  return { severity, code, message, hint };
}

/**
 * The rules that need one section and nothing else: is it a section this venue has, and does its
 * prose fit the limit. Word counts come from `words`, which strips citations, markers and
 * Markdown first, so a citation-dense paragraph is measured as the prose it is.
 *
 * @param {object} profile
 * @param {{section: string, text?: string|null}} input
 * @returns {{severity: string, code: string, message: string, hint: string|null}[]}
 */
export function checkSection(profile, { section, text = null } = {}) {
  const sections = orderedSections(profile);
  const index = sections.findIndex((entry) => entry.id === section);
  const findings = [];

  if (index === -1) {
    findings.push(
      finding(
        'warn',
        'section-unknown',
        `${profile.name} does not list a "${section}" section`,
        `${profile.name} expects: ${sections.map((s) => s.id).join(', ') || '(no sections)'}`,
      ),
    );
  }

  const limit = sectionLimit(profile, sections[index]);
  if (limit !== null && typeof text === 'string') {
    const count = words(text).length;
    if (count > limit) {
      findings.push(
        finding(
          'block',
          'section-words',
          `${count} words exceeds the ${limit}-word limit ${profile.name} sets for ${section}`,
          'cut the section, raise the limit in the venue profile, or drop target_profile',
        ),
      );
    }
  }

  return findings;
}

/**
 * A venue asks for a relative order, not for absolute positions: a section the manuscript does
 * not have leaves no gap behind it, and a section the venue does not list holds no place in it.
 * So the comparison is between the sections both of them have, in manuscript order, and the same
 * sections in venue order - and the first place the two disagree names the pair that is reversed.
 *
 * @param {object} profile
 * @param {{id: string}[]} entries - the manuscript's sections, in manuscript order
 * @returns {object[]} one finding, or none
 */
function orderFindings(profile, entries) {
  const ranks = new Map(orderedSections(profile).map((section, index) => [section.id, index]));
  const manuscript = entries.map((entry) => entry.id).filter((id) => ranks.has(id));
  const venue = [...manuscript].sort((a, b) => ranks.get(a) - ranks.get(b));

  const at = manuscript.findIndex((id, index) => id !== venue[index]);
  if (at === -1) return [];
  return [
    {
      ...finding(
        'warn',
        'section-order',
        `${profile.name} puts ${venue[at]} before ${manuscript[at]}; the manuscript has ${manuscript[at]} first`,
        'reorder the manuscript sections, or drop target_profile from manuscript.yaml',
      ),
      section: null,
    },
  ];
}

function figureFindings(profile, figures) {
  const accepted = profile?.figures?.formats ?? [];
  if (accepted.length === 0) return [];

  const findings = [];
  for (const figure of figures) {
    const formats = [...new Set((figure.outputs ?? []).map((output) => output.format))];
    if (formats.length === 0 || formats.some((format) => accepted.includes(format))) continue;
    findings.push({
      ...finding(
        'warn',
        'figure-format',
        `figure ${figure.name ?? figure.id} produces ${formats.join(', ')}; ${profile.name} takes ${accepted.join(', ')}`,
        `add ${accepted[0]} to the figure's outputs, or let the build convert it`,
      ),
      section: null,
    });
  }
  return findings;
}

function referenceFindings(profile) {
  const style =
    typeof profile?.references?.style === 'string' ? profile.references.style.trim() : '';
  if (style === '') {
    return [
      {
        ...finding(
          'warn',
          'references-style',
          `${profile.name} names no reference style`,
          'set references.style in the venue profile',
        ),
        section: null,
      },
    ];
  }
  return [
    {
      ...finding(
        'info',
        'references-style',
        `references follow ${style}`,
        profile.citation_style ? `citation style: ${profile.citation_style}` : null,
      ),
      section: null,
    },
  ];
}

/**
 * Every venue rule the manuscript can be judged against without rendering it.
 *
 * @param {object} manuscript - the manuscript, whose `sections` give the structure
 * @param {{id: string, body: string|null}[]} sections - the prose that is on disk, by section id
 * @param {object} profile - a profile the loader has validated
 * @param {{figures?: object[]}} [opts] - the declared figures, for the format rule
 * @returns {{severity: string, code: string, message: string, section: string|null,
 *   hint: string|null}[]} findings, the per-section ones in manuscript order
 */
export function checkProfile(manuscript, sections, profile, { figures = [] } = {}) {
  const bodies = new Map((sections ?? []).map((section) => [section.id, section.body]));
  const entries = [...(manuscript?.sections ?? [])].sort((a, b) => a.order - b.order);
  const present = new Set(entries.map((entry) => entry.id));
  const findings = [];

  for (const wanted of orderedSections(profile)) {
    if (present.has(wanted.id)) continue;
    findings.push(
      wanted.required === false
        ? {
            ...finding(
              'info',
              'section-optional',
              `${profile.name} also takes a ${wanted.id} section; the manuscript has none`,
              null,
            ),
            section: wanted.id,
          }
        : {
            ...finding(
              'block',
              'section-missing',
              `${profile.name} requires an ${wanted.id} section; the manuscript has none`,
              `phdude manuscript init writes the standard sections; add ${wanted.id} to manuscript.yaml`,
            ),
            section: wanted.id,
          },
    );
  }

  findings.push(...orderFindings(profile, entries));

  for (const entry of entries) {
    const body = bodies.get(entry.id) ?? null;
    for (const item of checkSection(profile, { section: entry.id, text: body })) {
      findings.push({ ...item, section: entry.id });
    }

    const wanted = orderedSections(profile).find((section) => section.id === entry.id);
    if (wanted && wanted.required !== false && typeof body !== 'string') {
      findings.push({
        ...finding(
          'info',
          'section-unwritten',
          `${entry.id} is ${entry.status} and has no prose to measure yet`,
          `phdude write ${entry.id}`,
        ),
        section: entry.id,
      });
    }
  }

  findings.push(...figureFindings(profile, figures));
  findings.push(...referenceFindings(profile));
  return findings;
}

/**
 * @param {{severity: string}[]} findings
 * @returns {{block: number, warn: number, info: number}}
 */
export function summarize(findings) {
  const counts = { block: 0, warn: 0, info: 0 };
  for (const item of findings ?? []) {
    if (counts[item.severity] !== undefined) counts[item.severity] += 1;
  }
  return counts;
}
