// Research gaps (PRD S112, spec S3.4): an explainable list of what the workspace is missing,
// grouped by severity. Every gap is derived, never invented — `why` cites real counts and ids,
// `command` is copy-pasteable.
import { openConflicts } from './conflicts.js';
import { disputedPairs } from './contradictions.js';
import { questionFreshness } from './freshness.js';
import { DEFAULT_FILTERS, ENABLE_NETWORK } from './policy.js';

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

function claimsAddressing(claims, questionId) {
  return claims.filter((c) => (c.questions ?? []).includes(questionId));
}

function gapsForQuestions(snapshot) {
  const questions = snapshot.questions ?? [];
  const claims = snapshot.claims ?? [];
  const methods = snapshot.methods ?? [];
  const gaps = [];

  for (const q of questions) {
    const addressing = claimsAddressing(claims, q.id);

    if (addressing.length === 0) {
      gaps.push({
        kind: 'question-without-claims',
        id: q.id,
        why: `${q.id} has 0 claims addressing it`,
        command: `phdude add claim --json '{"statement":"…","kind":"empirical","questions":["${q.id}"]}'`,
        severity: 'high',
      });
    } else if (addressing.every((c) => c.state === 'candidate')) {
      const ids = addressing.map((c) => c.id).sort();
      gaps.push({
        kind: 'question-only-candidates',
        id: q.id,
        why: `${q.id}'s ${ids.length} claim(s) are all still candidate: ${ids.join(', ')}`,
        command: `phdude promote ${ids[0]} --to supported`,
        severity: 'medium',
      });
    }

    const hasMethod = methods.some((m) => (m.questions ?? []).includes(q.id));
    if (!hasMethod) {
      gaps.push({
        kind: 'question-without-method',
        id: q.id,
        why: `${q.id} has no method addressing it`,
        command: `phdude add method --json '{"name":"…","design":"…","paradigm":"quantitative","questions":["${q.id}"]}'`,
        severity: 'medium',
      });
    }
  }

  return gaps;
}

// Literature the workspace has not gone looking for is a gap in the same sense an unaddressed
// question is: nothing is wrong with what is recorded, something is missing from it. A question
// nobody ever searched outranks one whose search has merely aged - the second at least has
// literature behind it.
function gapsForSearches(snapshot) {
  const questions = snapshot.questions ?? [];
  const staleAfterDays = snapshot.staleAfterDays ?? DEFAULT_FILTERS.staleAfterDays;
  const rows = questionFreshness(questions, snapshot.searches ?? [], snapshot.now, staleAfterDays);
  const textById = new Map(questions.map((q) => [q.id, q.text]));
  // A workspace that has closed the network has not overlooked the literature, it has decided
  // where the literature comes from. Never-searched stays on the report - it is still true -
  // but it drops to `low` and the command opens the policy first, because the search command
  // on its own would refuse.
  const closed = snapshot.networkEnabled === false;
  const gaps = [];

  for (const row of rows) {
    if (row.lastSearch === null) {
      const search = `phdude research "${textById.get(row.question) ?? '…'}" --question ${row.question}`;
      gaps.push({
        kind: 'question-never-searched',
        id: row.question,
        why: `${row.question} has never been searched for literature`,
        command: closed ? `${ENABLE_NETWORK}, then ${search}` : search,
        severity: closed ? 'low' : 'medium',
      });
    } else if (row.stale) {
      gaps.push({
        kind: 'stale-search',
        id: row.question,
        why: `${row.question}'s last search ran ${row.daysAgo} day(s) ago (stale after ${staleAfterDays})`,
        command: `phdude research-fresh --question ${row.question}`,
        severity: 'low',
      });
    }
  }

  return gaps;
}

function gapsForClaims(snapshot) {
  const claims = snapshot.claims ?? [];
  const evidenceById = new Map((snapshot.evidence ?? []).map((e) => [e.id, e]));
  const gaps = [];

  for (const claim of claims) {
    if (claim.state === 'rejected') continue;
    const supportedBy = claim.supported_by ?? [];

    if (supportedBy.length === 0) {
      gaps.push({
        kind: 'claim-without-evidence',
        id: claim.id,
        why: `${claim.id} has no evidence`,
        command: `phdude link ${claim.id} --to <EVID-id>`,
        severity: 'high',
      });
      continue;
    }

    const strengths = supportedBy.map((evId) => evidenceById.get(evId)?.strength).filter(Boolean);
    if (strengths.length > 0 && strengths.every((s) => s === 'weak')) {
      gaps.push({
        kind: 'claim-weak-evidence',
        id: claim.id,
        why: `${claim.id} is supported only by weak evidence: ${supportedBy.join(', ')}`,
        command: `phdude add evidence --json '{"source":"<SRC-id>","excerpt":"…","strength":"strong"}'`,
        severity: 'medium',
      });
    }
  }

  return gaps;
}

function gapsForHypotheses(snapshot) {
  const hypotheses = snapshot.hypotheses ?? [];
  const claims = snapshot.claims ?? [];
  const gaps = [];

  for (const h of hypotheses) {
    const hQuestions = new Set(h.questions ?? []);
    const tested = claims.some((c) => (c.questions ?? []).some((qId) => hQuestions.has(qId)));
    if (tested) continue;

    const firstQuestion = [...hQuestions].sort()[0];
    const command = firstQuestion
      ? `phdude add claim --json '{"statement":"…","kind":"empirical","questions":["${firstQuestion}"]}'`
      : `phdude link ${h.id} --to <RQ-id>`;

    gaps.push({
      kind: 'hypothesis-untested',
      id: h.id,
      why: `${h.id} has no claim addressing any of its question(s): ${[...hQuestions].sort().join(', ') || '(none)'}`,
      command,
      severity: 'medium',
    });
  }

  return gaps;
}

function gapsForSources(snapshot) {
  const sources = snapshot.sources ?? [];
  const evidence = snapshot.evidence ?? [];
  const citedSourceIds = new Set(evidence.map((e) => e.source));
  const gaps = [];

  for (const s of sources) {
    if (citedSourceIds.has(s.id)) continue;
    gaps.push({
      kind: 'uncited-source',
      id: s.id,
      why: `${s.id} is not cited by any evidence`,
      command: `phdude add evidence --json '{"source":"${s.id}","excerpt":"…","strength":"moderate"}'`,
      severity: 'low',
    });
  }

  return gaps;
}

function gapsForArtifacts(snapshot) {
  const artifacts = snapshot.artifacts ?? [];
  const sources = snapshot.sources ?? [];
  const facts = snapshot.facts ?? [];
  const evidence = snapshot.evidence ?? [];

  const referenced = new Set();
  for (const s of sources) for (const a of s.artifacts ?? []) referenced.add(a);
  for (const f of facts) if (f.from?.artifact) referenced.add(f.from.artifact);
  for (const e of evidence) referenced.add(e.source);

  const gaps = [];
  for (const a of artifacts) {
    if (a.role === 'unknown') continue;
    if (referenced.has(a.id)) continue;
    gaps.push({
      kind: 'artifact-unmined',
      id: a.id,
      why: `${a.id} (role: ${a.role}) is not referenced by any source, fact, or evidence`,
      command: `phdude add fact --json '{"key":"…","value":"…","from":{"artifact":"${a.id}"}}'`,
      severity: 'low',
    });
  }
  return gaps;
}

function distinctValuesText(conflict) {
  const groups = new Map();
  for (const v of conflict.values) {
    const label = `${v.value}${v.unit ? ' ' + v.unit : ''}`;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(v.from.artifact);
  }
  return [...groups.entries()].map(([label, arts]) => `${label} (${arts.join(', ')})`).join(' vs ');
}

function gapsForConflicts(conflicts) {
  return openConflicts(conflicts ?? []).map((c) => {
    const factIds = c.values.map((v) => v.factId);
    return {
      kind: 'open-conflict',
      id: c.key,
      why: `${c.key} has an open conflict: ${distinctValuesText(c)}`,
      command:
        `phdude decide propose --title "Resolve ${c.key}" --rationale "…" ` +
        `--affects ${factIds.join(' ')} --change '{"fact_key":"${c.key}","canonical_value":…}'`,
      severity: 'high',
    };
  });
}

function gapsForDisputed(snapshot) {
  const claims = snapshot.claims ?? [];
  return disputedPairs(claims).map(([a, b]) => ({
    kind: 'disputed-pair',
    id: `${a}/${b}`,
    why: `${a} and ${b} contradict each other and neither has been rejected`,
    command:
      `phdude decide propose --title "Resolve contradiction between ${a} and ${b}" --rationale "…" ` +
      `--affects ${a} ${b} --change '{"resolves_contradiction":["${a}","${b}"],"survivor":"${a}"}'`,
    severity: 'high',
  }));
}

function byseverityThenKindThenId(a, b) {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    a.kind.localeCompare(b.kind) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Pure. Explainable gap report (spec S3.4): questions without claims/method or only-candidate
 * claims, questions never searched or whose search has gone stale, claims with no or only-weak
 * evidence, untested hypotheses, uncited sources, unmined artifacts, open conflicts, and
 * disputed claim pairs.
 * @param {object} snapshot
 * @param {object[]} conflicts - all fact conflicts (open and resolved), from domain/conflicts.js
 * @returns {{kind: string, id: string, why: string, command: string, severity: 'high'|'medium'|'low'}[]}
 */
export function findGaps(snapshot, conflicts) {
  const gaps = [
    ...gapsForQuestions(snapshot),
    ...gapsForSearches(snapshot),
    ...gapsForClaims(snapshot),
    ...gapsForHypotheses(snapshot),
    ...gapsForSources(snapshot),
    ...gapsForArtifacts(snapshot),
    ...gapsForConflicts(conflicts),
    ...gapsForDisputed(snapshot),
  ];

  return gaps.sort(byseverityThenKindThenId);
}
