// Research Health (PRD §39, spec §3.3): eight dimensions, each a 0-100 number a researcher can
// re-derive from the observations printed beside it. Pure - the present arrives on the snapshot,
// the weights on the policy - so the same workspace always scores the same.
//
// What this is not, and never becomes, is a detector or "humanity" score (PRD §30c). Every
// number here is a count of things the workspace recorded about itself.
import { detectFactConflicts, openConflicts } from './conflicts.js';
import { disputedPairs } from './contradictions.js';
import { questionFreshness } from './freshness.js';
import { parseId } from './ids.js';
import { aggregateScore } from './prose-lint.js';
import { DEFAULT_FILTERS } from './policy.js';

const STATE_SCORE = { canonical: 100, supported: 80, candidate: 40, disputed: 20, rejected: 0 };

// `unknown` sits with `weak`: nothing on the record says the evidence is stronger than that,
// and a strength the researcher never assessed must not read as one they did.
const STRENGTH_FACTOR = { strong: 1, moderate: 0.75, weak: 0.5, unknown: 0.5 };

const CITATION_PENALTY = 10;
const METHODOLOGY_REVIEW_PENALTY = 20;
const CONSISTENCY_PENALTY = 25;

export const DIMENSIONS = [
  ['literature-coverage', 'Literature Coverage'],
  ['evidence-strength', 'Evidence Strength'],
  ['methodological-integrity', 'Methodological Integrity'],
  ['citation-quality', 'Citation Quality'],
  ['freshness', 'Freshness'],
  ['reproducibility', 'Reproducibility'],
  ['consistency', 'Consistency'],
  ['prose-quality', 'Academic Prose Quality'],
];

export const DEFAULT_WEIGHTS = Object.fromEntries(DIMENSIONS.map(([key]) => [key, 1]));

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percent(part, total) {
  return total === 0 ? 0 : (part / total) * 100;
}

function ids(objects) {
  return objects.map((o) => o.id ?? o).sort();
}

function openReviews(snapshot, kind) {
  return (snapshot.reviews ?? []).filter((r) => r.kind === kind && r.status === 'open');
}

function sourcesBehind(claim, evidenceById) {
  const sources = new Set();
  for (const evidenceId of claim.supported_by ?? []) {
    const source = evidenceById.get(evidenceId)?.source;
    if (parseId(source)?.type === 'source') sources.add(source);
  }
  return sources;
}

// Three readings of the same question set: has the literature produced a claim the workspace
// stands behind, is there a source under it at all, and has anybody looked recently.
function literatureCoverage(snapshot, { freshRows }) {
  const questions = snapshot.questions ?? [];
  if (questions.length === 0) {
    return { score: null, observations: [{ message: 'no research question is recorded' }] };
  }

  const claims = snapshot.claims ?? [];
  const evidenceById = new Map((snapshot.evidence ?? []).map((e) => [e.id, e]));
  const unanswered = [];
  const unsourced = [];

  for (const question of questions) {
    const addressing = claims.filter((c) => (c.questions ?? []).includes(question.id));
    const settled = addressing.some((c) => c.state === 'supported' || c.state === 'canonical');
    if (!settled) unanswered.push(question.id);

    const sources = addressing.reduce(
      (all, claim) => new Set([...all, ...sourcesBehind(claim, evidenceById)]),
      new Set(),
    );
    if (sources.size === 0) unsourced.push(question.id);
  }

  const stale = freshRows.filter((row) => row.stale).map((row) => row.question);
  const total = questions.length;
  const answered = percent(total - unanswered.length, total);
  const sourced = percent(total - unsourced.length, total);
  const fresh = 100 - percent(stale.length, total);

  return {
    score: clamp(mean([answered, sourced, fresh])),
    observations: [
      {
        message: `${total - unanswered.length}/${total} question(s) have a supported or canonical claim (${Math.round(answered)}%)`,
        ids: unanswered.sort(),
      },
      {
        message: `${total - unsourced.length}/${total} question(s) have a source behind them (${Math.round(sourced)}%)`,
        ids: unsourced.sort(),
      },
      {
        message: `${total - stale.length}/${total} question(s) have a search that is not stale (${Math.round(fresh)}%)`,
        ids: stale.sort(),
      },
    ],
  };
}

function tally(objects, field, order) {
  const counts = new Map(order.map((value) => [value, 0]));
  for (const object of objects) {
    const value = object[field];
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count > 0)
    .map(([value, count]) => `${count} ${value}`)
    .join(', ');
}

// The states the claims are in, discounted by how strong the evidence under them is. A workspace
// with claims and no evidence at all scores 0: the states were recorded, nothing supports them.
function evidenceStrength(snapshot) {
  const claims = snapshot.claims ?? [];
  if (claims.length === 0) {
    return { score: null, observations: [{ message: 'no claim is recorded' }] };
  }

  const evidence = snapshot.evidence ?? [];
  const states = mean(claims.map((c) => STATE_SCORE[c.state] ?? 0));
  const factor =
    evidence.length === 0 ? 0 : mean(evidence.map((e) => STRENGTH_FACTOR[e.strength] ?? 0.5));

  return {
    score: clamp(states * factor),
    observations: [
      {
        message: `${claims.length} claim(s) average ${Math.round(states)}/100 by state: ${tally(claims, 'state', Object.keys(STATE_SCORE))}`,
      },
      {
        message:
          evidence.length === 0
            ? 'no evidence is recorded, so the strength factor is 0'
            : `${evidence.length} evidence item(s) give a strength factor of ${factor.toFixed(2)}: ${tally(evidence, 'strength', Object.keys(STRENGTH_FACTOR))}`,
      },
    ],
  };
}

function methodologicalIntegrity(snapshot) {
  const questions = snapshot.questions ?? [];
  const methods = snapshot.methods ?? [];
  if (questions.length === 0 && methods.length === 0) {
    return {
      score: null,
      observations: [{ message: 'no research question and no method are recorded' }],
    };
  }

  const observations = [];
  const parts = [];

  if (questions.length > 0) {
    const without = questions
      .filter((q) => !methods.some((m) => (m.questions ?? []).includes(q.id)))
      .map((q) => q.id)
      .sort();
    const covered = percent(questions.length - without.length, questions.length);
    parts.push(covered);
    observations.push({
      message: `${questions.length - without.length}/${questions.length} question(s) have a method (${Math.round(covered)}%)`,
      ids: without,
    });
  }

  if (methods.length > 0) {
    const without = methods
      .filter((m) => (m.limitations ?? []).length === 0)
      .map((m) => m.id)
      .sort();
    const declared = percent(methods.length - without.length, methods.length);
    parts.push(declared);
    observations.push({
      message: `${methods.length - without.length}/${methods.length} method(s) declare limitations (${Math.round(declared)}%)`,
      ids: without,
    });
  }

  const open = openReviews(snapshot, 'methodology');
  if (open.length > 0) {
    observations.push({
      message: `${open.length} open methodology review(s), ${METHODOLOGY_REVIEW_PENALTY} points each`,
      ids: ids(open),
    });
  }

  return {
    score: clamp(mean(parts) - METHODOLOGY_REVIEW_PENALTY * open.length),
    observations,
  };
}

// `uncited-source` is the one `cite check` finding that never fails `ok` - it is a gap in the
// argument, not a fault in the registry - so it is reported here and charged for nowhere.
function citationQuality(snapshot) {
  const sources = snapshot.sources ?? [];
  const open = openReviews(snapshot, 'citation');
  if (sources.length === 0 && open.length === 0) {
    return { score: null, observations: [{ message: 'no source is recorded' }] };
  }

  const all = snapshot.citations ?? [];
  const uncited = all.filter((f) => f.kind === 'uncited-source');
  const findings = all.filter((f) => f.kind !== 'uncited-source');
  const charged = findings.length + open.length;

  const observations = [
    {
      message: `${sources.length} source(s), ${charged} finding(s) charged at ${CITATION_PENALTY} points each`,
    },
  ];
  for (const finding of findings) {
    observations.push({ message: finding.message ?? finding.kind, ids: [finding.id] });
  }
  for (const review of open) {
    observations.push({ message: review.message, ids: [review.id] });
  }
  if (uncited.length > 0) {
    observations.push({
      message: `${uncited.length} source(s) are cited by no evidence; that is a gap, not a citation fault, and costs nothing here`,
      ids: ids(uncited),
    });
  }

  return { score: clamp(100 - CITATION_PENALTY * charged), observations };
}

function freshness(snapshot, { freshRows, staleAfterDays }) {
  const questions = snapshot.questions ?? [];
  if (questions.length === 0) {
    return { score: null, observations: [{ message: 'no research question is recorded' }] };
  }

  const stale = freshRows.filter((row) => row.stale);
  const never = freshRows.filter((row) => row.lastSearch === null);

  return {
    score: clamp(100 - percent(stale.length, questions.length)),
    observations: [
      {
        message: `${stale.length}/${questions.length} question(s) have a stale search (stale after ${staleAfterDays} day(s))`,
        ids: stale.map((row) => row.question).sort(),
      },
      {
        message: `${never.length} question(s) have never been searched`,
        ids: never.map((row) => row.question).sort(),
      },
    ],
  };
}

// Null rather than 100 when nothing is declared: a workspace with no analysis, table or figure
// has not proved it is reproducible, and a free 100 would carry the overall up on nothing.
function reproducibility(snapshot) {
  const items = snapshot.repro ?? [];
  if (items.length === 0) {
    return {
      score: null,
      observations: [{ message: 'no analysis, table or figure is declared' }],
    };
  }

  const behind = items.filter((item) => item.status !== 'up-to-date');

  return {
    score: clamp(percent(items.length - behind.length, items.length)),
    observations: [
      {
        message: `${items.length - behind.length}/${items.length} declared item(s) are up to date`,
        ids: ids(behind),
      },
    ],
  };
}

function consistency(snapshot) {
  const facts = snapshot.facts ?? [];
  const claims = snapshot.claims ?? [];
  if (facts.length === 0 && claims.length === 0) {
    return { score: null, observations: [{ message: 'no fact and no claim is recorded' }] };
  }

  const conflicts = openConflicts(detectFactConflicts(facts, snapshot.decisions ?? []));
  const disputed = disputedPairs(claims);

  return {
    score: clamp(
      100 - CONSISTENCY_PENALTY * conflicts.length - CONSISTENCY_PENALTY * disputed.length,
    ),
    observations: [
      {
        message: `${conflicts.length} open fact conflict(s), ${CONSISTENCY_PENALTY} points each`,
        ids: conflicts.map((c) => c.key).sort(),
      },
      {
        message: `${disputed.length} disputed claim pair(s), ${CONSISTENCY_PENALTY} points each`,
        ids: disputed.map(([a, b]) => `${a}/${b}`),
      },
    ],
  };
}

function proseQuality(snapshot) {
  if (!snapshot.manuscript) {
    return { score: null, observations: [{ message: 'the workspace has no manuscript' }] };
  }

  // The stored section reports keep the six sub-scores, not the aggregate, so the aggregate is
  // recomputed here through the same function `phdude prose` prints - never a second formula.
  const scored = (snapshot.sectionReports ?? [])
    .map((report) => ({ section: report.section, aggregate: aggregateScore(report.scores) }))
    .filter((row) => row.aggregate !== null);

  if (scored.length === 0) {
    return {
      score: null,
      observations: [{ message: 'no section has a prose report yet' }],
    };
  }

  return {
    score: clamp(mean(scored.map((row) => row.aggregate))),
    observations: scored.map((row) => ({ message: `${row.section}: ${row.aggregate}/100` })),
  };
}

/**
 * The weight of each dimension in the overall, from `health.weights` in the research policy. A
 * weight that is not a finite number at or above zero is unusable, so it falls back to the
 * default rather than poisoning the mean; 0 is usable and drops the dimension from the overall.
 * @param {object|null} policy - the parsed `.phdude/research-policy.yaml`
 * @returns {Record<string, number>}
 */
export function healthWeights(policy) {
  const configured = policy?.health?.weights;
  const weights = { ...DEFAULT_WEIGHTS };
  if (configured === null || typeof configured !== 'object') return weights;

  for (const [key, value] of Object.entries(configured)) {
    if (!Object.hasOwn(weights, key)) continue;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) weights[key] = value;
  }
  return weights;
}

const BUILDERS = {
  'literature-coverage': literatureCoverage,
  'evidence-strength': evidenceStrength,
  'methodological-integrity': methodologicalIntegrity,
  'citation-quality': citationQuality,
  freshness,
  reproducibility,
  consistency,
  'prose-quality': proseQuality,
};

/**
 * Pure. The eight-dimension Research Health report.
 * @param {object} snapshot - a workspace snapshot; `citations` carries the `cite check` findings
 *   the application resolved, `reviews` the REVIEW objects on file (both optional)
 * @param {object|null} policy - the parsed research policy, read for `health.weights`
 * @returns {{dimensions: {key: string, label: string, score: number|null, weight: number,
 *   observations: {message: string, ids?: string[]}[]}[], overall: number|null,
 *   weights: Record<string, number>}}
 */
export function health(snapshot, policy) {
  const weights = healthWeights(policy);
  const staleAfterDays = snapshot.staleAfterDays ?? DEFAULT_FILTERS.staleAfterDays;
  const context = {
    staleAfterDays,
    freshRows: questionFreshness(
      snapshot.questions ?? [],
      snapshot.searches ?? [],
      snapshot.now,
      staleAfterDays,
    ),
  };

  const dimensions = DIMENSIONS.map(([key, label]) => {
    const { score, observations } = BUILDERS[key](snapshot, context);
    return {
      key,
      label,
      score,
      weight: weights[key],
      observations: observations.map((o) =>
        (o.ids ?? []).length === 0 ? { message: o.message } : { message: o.message, ids: o.ids },
      ),
    };
  });

  const scored = dimensions.filter((d) => d.score !== null && d.weight > 0);
  const total = scored.reduce((sum, d) => sum + d.weight, 0);
  const overall =
    total === 0 ? null : Math.round(scored.reduce((sum, d) => sum + d.score * d.weight, 0) / total);

  return { dimensions, overall, weights };
}
