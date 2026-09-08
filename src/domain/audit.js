// The citation auditor's rules (spec §3.1). Everything here is a pure reading of what the
// workspace already records: the offline rules over the manuscript and the registry, and the
// comparison of one source against the metadata a DOI resolver returned. Nothing here fetches
// anything — the application hands the resolver's answer in — and nothing here writes: a
// finding is a plain object the application turns into a REVIEW.

import { citationsIn } from './gates/citations.js';
import { markerInventory } from './gates/markers.js';
import { parseId } from './ids.js';
import { parseSectionFile } from './manuscript.js';
import { normalizeDoi } from './normalize.js';
import { TITLE_SIMILARITY_THRESHOLD, titleSimilarity } from './similarity.js';

// What each `cite check` finding weighs once it is a review. `uncited-source` is the one kind
// `cite check` never fails on — it is a gap in the argument, not a fault in the registry — so
// it is recorded as a note and blocks nothing.
export const CITE_FINDING_SEVERITY = {
  'uncited-source': 'note',
  'evidence-missing-source': 'block',
  'invalid-doi': 'major',
  'missing-field': 'minor',
  'duplicate-source': 'major',
  'duplicate-bibkey': 'major',
};

// A Crossref year and a recorded year may differ by one and still describe the same work:
// online-first publication, an issue dated to the following January (spec §3.1).
const YEAR_TOLERANCE = 1;

const SEVERITY_ORDER = ['block', 'major', 'minor', 'note'];

/**
 * @param {object[]} findings
 * @returns {object[]} a new array, worst first, then by target, rule and message
 */
export function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.target.localeCompare(b.target) ||
      a.rule.localeCompare(b.rule) ||
      a.message.localeCompare(b.message),
  );
}

/**
 * The DOI a source records, wherever it recorded it.
 * @param {object} source
 * @returns {string|null}
 */
export function sourceDoi(source) {
  return normalizeDoi(source?.identifiers?.doi ?? source?.doi);
}

/**
 * Which candidate record describes each source: the one `research accept` linked, and failing
 * that the one reporting the same DOI. The second case is the source a researcher added by
 * hand for a work that is also sitting in the candidate list, which is exactly the pair the
 * `unreviewed-source` and `dismissed-source` rules exist to catch.
 * @param {object[]} sources
 * @param {object[]} candidates
 * @returns {Map<string, object>} source id → candidate; a source no candidate describes is absent
 */
export function indexCandidates(sources, candidates) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const byDoi = new Map();
  for (const candidate of candidates) {
    const doi = normalizeDoi(candidate.doi);
    if (doi && !byDoi.has(doi)) byDoi.set(doi, candidate);
  }

  const index = new Map();
  for (const source of sources) {
    const doi = sourceDoi(source);
    const match = byId.get(source.ext?.research?.candidate) ?? (doi ? byDoi.get(doi) : undefined);
    if (match) index.set(source.id, match);
  }
  return index;
}

// A hint is offered as the command to run only when it is one: `cite check` writes some hints
// as prose ("merge the duplicate sources"), and a review that suggests running a sentence is
// worse than one that suggests nothing.
function commandIn(hint) {
  return typeof hint === 'string' && hint.startsWith('phdude ') ? hint : undefined;
}

function finding({ rule, target, severity, message, evidence = [], suggested_command }) {
  const item = { rule, target, severity, message, evidence };
  if (suggested_command !== undefined) item.suggested_command = suggested_command;
  return item;
}

// "Cited" for the offline rules means cited in the prose, by SRC id or by bibkey. Evidence
// citing a source is `cite check`'s business and arrives through `citeFindings`.
function citedSourceIds(sections, { sourcesById, sourcesByBibkey }, findings) {
  const cited = new Set();

  for (const section of sections) {
    const seen = new Set();
    for (const { key } of citationsIn(section.body)) {
      if (seen.has(key)) continue;
      seen.add(key);

      const source = sourcesById.get(key) ?? sourcesByBibkey.get(key);
      if (source) {
        cited.add(source.id);
        continue;
      }
      findings.push(
        finding({
          rule: 'unresolved-citation',
          target: `manuscript:${section.id}`,
          severity: 'block',
          message: `[@${key}] in the ${section.id} section does not resolve to a recorded source`,
          suggested_command: 'phdude cite list',
        }),
      );
    }
  }

  return cited;
}

// A claim the prose asserts has to rest on evidence that cites a source the registry records.
// Evidence quoting a raw artifact is not that yet: it is the reading of a file nobody has
// entered into the bibliography, and prose resting on it cites nothing a reader can check.
function unsourcedClaims(sections, { claimsById, evidenceById }, findings) {
  for (const section of sections) {
    const inventory = markerInventory(section.body, { claimsById, evidenceById });
    const asserted = [...new Set(inventory.claims.map((claim) => claim.id))].sort();

    for (const id of asserted) {
      const claim = claimsById.get(id);
      // A marker naming nothing is `gate-evidence`'s finding, and reporting it twice would ask
      // the researcher to fix one problem in two places.
      if (!claim) continue;

      const backed = (claim.supported_by ?? []).some(
        (evidenceId) => parseId(evidenceById.get(evidenceId)?.source)?.type === 'source',
      );
      if (backed) continue;

      findings.push(
        finding({
          rule: 'unsourced-claim',
          target: `manuscript:${section.id}`,
          severity: 'major',
          message: `${id} is asserted in the ${section.id} section, and no evidence behind it cites a recorded source`,
          evidence: [id],
          suggested_command: `phdude link ${id} --to <EV-id>`,
        }),
      );
    }
  }
}

// A work the researcher never actually ruled on, cited as though they had. `dismissed` is the
// worse half: the researcher looked at that paper and said no, and the prose cites it anyway.
function unreviewedSources(cited, candidateBySource, findings) {
  for (const sourceId of [...cited].sort()) {
    const candidate = candidateBySource.get(sourceId);
    if (!candidate) continue;

    if (candidate.state === 'dismissed') {
      findings.push(
        finding({
          rule: 'dismissed-source',
          target: sourceId,
          severity: 'major',
          message: `${sourceId} is cited in the manuscript, and ${candidate.id} was dismissed`,
          evidence: [candidate.id],
          suggested_command: `phdude research show ${candidate.id}`,
        }),
      );
    } else if (candidate.state === 'candidate') {
      findings.push(
        finding({
          rule: 'unreviewed-source',
          target: sourceId,
          severity: 'minor',
          message: `${sourceId} is cited in the manuscript while ${candidate.id} is still awaiting review`,
          evidence: [candidate.id],
          suggested_command: `phdude research accept ${candidate.id}`,
        }),
      );
    }
  }
}

/**
 * Every offline rule, over the manuscript and the registry (spec §3.1).
 * @param {object} input
 * @param {{id: string, text: string}[]} input.sections - section id and the file as written,
 *   front matter included; the prose is taken from the body
 * @param {Map<string, object>} input.sourcesById
 * @param {Map<string, object>} input.sourcesByBibkey
 * @param {Map<string, object>} input.claimsById
 * @param {Map<string, object>} input.evidenceById
 * @param {Map<string, object>} input.candidateBySource - from `indexCandidates`
 * @param {{kind: string, id: string, message: string, hint?: string}[]} input.citeFindings
 * @returns {{rule: string, target: string, severity: string, message: string,
 *   evidence: string[], suggested_command?: string}[]} worst first
 */
export function offlineFindings({
  sections = [],
  sourcesById = new Map(),
  sourcesByBibkey = new Map(),
  claimsById = new Map(),
  evidenceById = new Map(),
  candidateBySource = new Map(),
  citeFindings = [],
} = {}) {
  const bodies = sections.map((section) => ({
    id: section.id,
    body: parseSectionFile(section.text).body,
  }));
  const findings = [];

  const cited = citedSourceIds(bodies, { sourcesById, sourcesByBibkey }, findings);
  unsourcedClaims(bodies, { claimsById, evidenceById }, findings);
  unreviewedSources(cited, candidateBySource, findings);

  for (const item of citeFindings) {
    findings.push(
      finding({
        rule: `cite:${item.kind}`,
        target: item.id,
        severity: CITE_FINDING_SEVERITY[item.kind] ?? 'minor',
        message: item.message,
        suggested_command: commandIn(item.hint),
      }),
    );
  }

  return sortFindings(findings);
}

/**
 * One source against what the DOI resolver returned (spec §3.1). A comparison the workspace
 * cannot make — no recorded title, no year on either side — is left unmade rather than
 * reported as a mismatch.
 * @param {object} source
 * @param {string} doi - the normalized DOI that was looked up
 * @param {{title: string|null, year: number|null, retracted: boolean}|null} record - null when
 *   the resolver does not know the DOI
 * @returns {object[]} findings, worst first
 */
export function doiFindings(source, doi, record) {
  // Every mismatch has the same first suspect: the identifier, which is the one field of a
  // source that is not part of its identity and can therefore be corrected in place.
  const correctDoi = `phdude edit ${source.id} --json '{"identifiers":{"doi":"10.…"}}'`;

  if (record === null || record === undefined) {
    return [
      finding({
        rule: 'doi-unresolved',
        target: source.id,
        severity: 'major',
        message: `${source.id} records the DOI ${doi}, which Crossref does not resolve`,
        suggested_command: correctDoi,
      }),
    ];
  }

  const findings = [];

  if (record.retracted === true) {
    findings.push(
      finding({
        rule: 'retracted-source',
        target: source.id,
        severity: 'block',
        // No command stops citing a paper: this one is the researcher's to answer.
        message: `Crossref records a retraction for ${doi}, cited as ${source.id}`,
      }),
    );
  }

  if (source.title && record.title) {
    const score = titleSimilarity(source.title, record.title);
    if (score < TITLE_SIMILARITY_THRESHOLD) {
      findings.push(
        finding({
          rule: 'title-mismatch',
          target: source.id,
          severity: 'major',
          message:
            `${doi} is titled "${record.title}" at Crossref, which does not match ` +
            `${source.id} (similarity ${score.toFixed(2)})`,
          suggested_command: correctDoi,
        }),
      );
    }
  }

  if (Number.isInteger(source.year) && Number.isInteger(record.year)) {
    if (Math.abs(source.year - record.year) > YEAR_TOLERANCE) {
      findings.push(
        finding({
          rule: 'year-mismatch',
          target: source.id,
          severity: 'minor',
          message: `Crossref dates ${doi} to ${record.year}; ${source.id} records ${source.year}`,
          suggested_command: correctDoi,
        }),
      );
    }
  }

  return sortFindings(findings);
}
