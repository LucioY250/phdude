import { join } from 'node:path';
import {
  doiFindings,
  indexCandidates,
  offlineFindings,
  sortFindings,
  sourceDoi,
} from '../domain/audit.js';
import { assignBibkeys } from '../domain/bibkey.js';
import { newReview } from '../domain/entities.js';
import { networkAllowed } from '../domain/policy.js';
import { check } from './cite.js';
import { assertUpToDate } from './guard.js';
import { REVIEW_MODES } from './mode.js';
import { loadSnapshot } from './snapshot.js';

// `phdude audit citations` (spec §3.1): the offline rules always, the DOI verification only
// when the network policy allows it, and what both found recorded as `citation` REVIEW
// objects. It is a report a researcher reads and a mutator at the same time - the findings are
// the record - so it records one `audit` event when it recorded anything, and nothing when the
// re-run found exactly what was already on file.

const POLICY_PATH = join('.phdude', 'research-policy.yaml');

// The sections whose prose is on disk, in reading order. A planned section has no draft to
// audit, and a section whose file has gone missing is `manuscript status`'s problem.
function sectionsOf(snapshot) {
  return [...(snapshot.manuscript?.sections ?? [])]
    .filter((section) => typeof snapshot.sectionBodies?.[section.id] === 'string')
    .sort((a, b) => a.order - b.order)
    .map((section) => ({ id: section.id, text: snapshot.sectionBodies[section.id] }));
}

// The DOI checks, one source at a time. A lookup that fails is a warning rather than a
// finding: "Crossref did not answer" and "Crossref does not know this DOI" are different
// statements, and only the second is something the researcher has to fix.
async function verifyDois(lookupDoi, sources, warnings) {
  const findings = [];
  let checked = 0;

  for (const source of sources) {
    const doi = sourceDoi(source);
    if (doi === null) continue;

    try {
      const record = await lookupDoi(doi);
      findings.push(...doiFindings(source, doi, record));
      checked += 1;
    } catch (err) {
      warnings.push(`${source.id}: ${err.message}`);
    }
  }

  return { findings, checked };
}

/**
 * Audits the citation registry and the manuscript, and records what it found (spec §3.1). A
 * finding already on file - the same kind, target and message - is left exactly as it is,
 * verdict included: re-running the audit must not reopen a finding the researcher dismissed.
 *
 * Block findings do not change the exit code. This command reports; `phdude ready` is where a
 * block stops a submission.
 * @param {{store: object, clock: () => string, actor: object,
 *   lookupDoi?: (doi: string) => Promise<object|null>}} deps
 * @param {{allowNetwork?: boolean}} [opts]
 * @returns {Promise<{created: object[], existing: object[], network: boolean, checked: number,
 *   sources: number, warnings: string[]}>}
 */
export async function citations({ store, clock, actor, lookupDoi }, { allowNetwork = false } = {}) {
  const snapshot = await loadSnapshot(store, clock);
  assertUpToDate(snapshot.project);

  const sources = [...snapshot.sources].sort((a, b) => a.id.localeCompare(b.id));
  const bibkeys = assignBibkeys(sources);
  const { findings: citeFindings } = await check({ store, snapshot });

  const findings = offlineFindings({
    sections: sectionsOf(snapshot),
    sourcesById: new Map(sources.map((source) => [source.id, source])),
    sourcesByBibkey: new Map(sources.map((source) => [bibkeys.get(source.id), source])),
    claimsById: new Map(snapshot.claims.map((claim) => [claim.id, claim])),
    evidenceById: new Map(snapshot.evidence.map((item) => [item.id, item])),
    candidateBySource: indexCandidates(sources, snapshot.candidates),
    citeFindings,
  });

  const warnings = [];
  const policy = await store.readYaml(POLICY_PATH);
  const network = networkAllowed(policy, { allowNetwork });
  let checked = 0;

  if (network && typeof lookupDoi === 'function') {
    const online = await verifyDois(lookupDoi, sources, warnings);
    findings.push(...online.findings);
    checked = online.checked;
  }

  const mode = REVIEW_MODES.includes(snapshot.project?.mode) ? snapshot.project.mode : 'full';
  const created = [];
  const existing = [];

  for (const finding of sortFindings(findings)) {
    const review = newReview({
      target: finding.target,
      severity: finding.severity,
      message: finding.message,
      evidence: finding.evidence,
      suggested_command: finding.suggested_command,
      kind: 'citation',
      by: actor,
      mode,
      actor,
      created: clock(),
    });

    const already = await store.readEntity(review.id);
    if (already) {
      existing.push(already);
      continue;
    }
    await store.writeEntity(review);
    created.push(review);
  }

  if (created.length > 0) {
    await store.appendEvent({
      ts: clock(),
      op: 'audit',
      actor,
      ids: created.map((review) => review.id),
      summary:
        `citation audit: ${created.length} finding(s) recorded` +
        (existing.length > 0 ? `, ${existing.length} already recorded` : '') +
        (network ? `, ${checked} DOI(s) verified` : ', offline'),
    });
  }

  return { created, existing, network, checked, sources: sources.length, warnings };
}
