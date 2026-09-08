// Submission readiness (PRD §42, spec §3.4): the one verdict that composes what the workspace
// already knows about itself - the venue's own rules, Research Health, the requirements the
// policy lists, and the gaps that outrank everything else - into "can this go out", and when it
// cannot, the list of what is in the way with the command that fixes each.
//
// Pure, and nothing here writes: a verdict is a reading of the record, never a change to it.
// Every check reports the same way whether it passed or failed, so `--json` carries the whole
// gate and not only its complaints.
import { CITE_FINDING_SEVERITY } from './audit.js';
import { detectFactConflicts, openConflicts } from './conflicts.js';
import { disputedPairs } from './contradictions.js';
import { findGaps } from './gaps.js';
import { health } from './health.js';
import { parseSectionFile } from './manuscript.js';
import { checkProfile } from './profiles.js';
import { promoteSeverity } from './reviews.js';

export const DEFAULT_MIN_HEALTH = 70;

// The order requirements are reported in, and the set `.phdude/research-policy.yaml` defaults
// to. A policy that lists them in another order does not reorder the report.
export const REQUIREMENTS = [
  'no-open-conflicts',
  'no-disputed-pairs',
  'no-block-reviews',
  'all-sections-approved',
  'figures-alt',
  'repro-clean',
  'citations-clean',
];

// The gap kinds a requirement already reports, so `gaps-high` does not ask for the same fix
// twice. A requirement the policy dropped puts its gaps back on the gap check.
const COVERED_GAPS = {
  'no-open-conflicts': 'open-conflict',
  'no-disputed-pairs': 'disputed-pair',
};

function pass(message, command) {
  return { ok: true, severity: null, message, command };
}

function fail(severity, message, command) {
  return { ok: false, severity, message, command };
}

function ids(objects) {
  return objects.map((object) => object.id ?? object).sort();
}

function openReviews(snapshot) {
  return (snapshot.reviews ?? []).filter((review) => review.status === 'open');
}

function noOpenConflicts(snapshot, { conflicts, gaps }) {
  const open = openConflicts(conflicts);
  if (open.length === 0) return pass('no fact conflict is open', 'phdude status');

  const keys = open.map((conflict) => conflict.key).sort();
  return fail(
    'major',
    `${open.length} open fact conflict(s): ${keys.join(', ')}`,
    gaps.find((gap) => gap.kind === 'open-conflict').command,
  );
}

function noDisputedPairs(snapshot, { gaps }) {
  const pairs = disputedPairs(snapshot.claims ?? []);
  if (pairs.length === 0) return pass('no claim pair is disputed', 'phdude status');

  return fail(
    'major',
    `${pairs.length} disputed claim pair(s): ${pairs.map(([a, b]) => `${a}/${b}`).join(', ')}`,
    gaps.find((gap) => gap.kind === 'disputed-pair').command,
  );
}

// The mode bites here: `ruthless` promotes an open `major` finding to `block` at the point the
// verdict is computed, and the stored review keeps the severity its reviewer wrote.
function noBlockReviews(snapshot, { promote }) {
  const open = openReviews(snapshot);
  const blocking = open.filter((review) => promote(review.severity) === 'block');
  if (blocking.length === 0) {
    return pass(`${open.length} open review finding(s), none blocking`, 'phdude review list');
  }

  const listed = ids(blocking);
  return fail(
    'block',
    `${blocking.length} open review finding(s) block: ${listed.join(', ')}`,
    `phdude review show ${listed[0]}`,
  );
}

function allSectionsApproved(snapshot) {
  const manuscript = snapshot.manuscript;
  if (!manuscript) {
    return fail('block', 'the workspace has no manuscript', 'phdude manuscript init');
  }

  const sections = manuscript.sections ?? [];
  if (sections.length === 0) {
    return fail('block', 'the manuscript plans no section', 'phdude manuscript init');
  }

  const waiting = sections.filter((section) => section.status !== 'approved').map((s) => s.id);
  if (waiting.length === 0) {
    return pass(`${sections.length} section(s) are approved`, 'phdude manuscript status');
  }
  return fail(
    'block',
    `${waiting.length} of ${sections.length} section(s) are not approved: ${waiting.join(', ')}`,
    'phdude manuscript status',
  );
}

// A figure without alt text cannot be published (PRD §100). `phdude figure add` refuses one, so
// this catches a record that reached the workspace another way.
function figuresAlt(snapshot) {
  const figures = snapshot.figures ?? [];
  const missing = figures.filter((figure) => String(figure.alt ?? '').trim() === '');
  if (missing.length === 0) {
    return pass(
      figures.length === 0 ? 'no figure is declared' : `${figures.length} figure(s) have alt text`,
      'phdude figure check',
    );
  }
  return fail(
    'block',
    `${missing.length} figure(s) have no alt text: ${ids(missing).join(', ')}`,
    'phdude figure check',
  );
}

function reproClean(snapshot) {
  const items = snapshot.repro ?? [];
  const behind = items.filter((item) => item.status !== 'up-to-date');
  if (behind.length === 0) {
    return pass(
      items.length === 0
        ? 'no analysis, table or figure is declared'
        : `${items.length} declared item(s) are up to date`,
      'phdude repro check',
    );
  }
  return fail(
    'major',
    `${behind.length} of ${items.length} declared item(s) need re-running: ${ids(behind).join(', ')}`,
    'phdude repro check',
  );
}

// Two readings of the same question, and `ready` never runs the auditor itself: the offline
// `cite check` findings, which are read-only, and the citation findings a previous
// `phdude audit citations` recorded and the researcher has not ruled on yet.
function citationsClean(snapshot, { promote }) {
  const findings = (snapshot.citations ?? []).filter(
    (finding) => CITE_FINDING_SEVERITY[finding.kind] === 'block',
  );
  const reviews = openReviews(snapshot).filter(
    (review) => review.kind === 'citation' && ['block', 'major'].includes(promote(review.severity)),
  );

  if (findings.length === 0 && reviews.length === 0) {
    return pass('the citations resolve and no citation finding is open', 'phdude cite check');
  }

  const parts = [];
  if (findings.length > 0) parts.push(`${findings.length} citation(s) resolve to nothing`);
  if (reviews.length > 0) parts.push(`${reviews.length} open citation finding(s)`);
  const named = [...ids(findings), ...ids(reviews)];
  const severity =
    findings.length > 0 || reviews.some((review) => promote(review.severity) === 'block')
      ? 'block'
      : 'major';

  return fail(severity, `${parts.join(', ')}: ${named.join(', ')}`, 'phdude audit citations');
}

const BUILDERS = {
  'no-open-conflicts': noOpenConflicts,
  'no-disputed-pairs': noDisputedPairs,
  'no-block-reviews': noBlockReviews,
  'all-sections-approved': allSectionsApproved,
  'figures-alt': figuresAlt,
  'repro-clean': reproClean,
  'citations-clean': citationsClean,
};

function minHealth(snapshot, { overall, threshold }) {
  if (overall === null) {
    return pass('nothing recorded scores yet, so there is no health to measure', 'phdude health');
  }
  if (overall >= threshold) {
    return pass(
      `Research Health is ${overall}/100, at or above the required ${threshold}`,
      'phdude health',
    );
  }
  return fail(
    'major',
    `Research Health is ${overall}/100, below the required ${threshold}`,
    'phdude health',
  );
}

function highGaps(snapshot, { gaps, required }) {
  const covered = new Set(
    Object.entries(COVERED_GAPS)
      .filter(([key]) => required.has(key))
      .map(([, kind]) => kind),
  );
  const high = gaps.filter((gap) => gap.severity === 'high' && !covered.has(gap.kind));
  if (high.length === 0) return pass('no high-severity gap is open', 'phdude gaps');

  const listed = high.map((gap) => `${gap.kind} ${gap.id}`);
  return fail('major', `${high.length} high-severity gap(s): ${listed.join(', ')}`, 'phdude gaps');
}

// Only the venue's blocking findings reach the verdict (spec §3.4): a warning is the venue's
// advice and `phdude profile check` is where the researcher reads all of it.
function profileChecks(snapshot, profile) {
  if (profile === null || !snapshot.manuscript) return [];

  const sections = [];
  for (const entry of snapshot.manuscript.sections ?? []) {
    const text = snapshot.sectionBodies?.[entry.id];
    if (typeof text !== 'string') continue;
    sections.push({ id: entry.id, body: parseSectionFile(text).body });
  }

  const command = `phdude profile check --profile ${profile.name}`;
  const blocking = checkProfile(snapshot.manuscript, sections, profile, {
    figures: snapshot.figures ?? [],
  }).filter((finding) => finding.severity === 'block');

  if (blocking.length === 0) {
    return [{ code: 'profile-check', ...pass(`${profile.name} blocks nothing`, command) }];
  }
  return blocking.map((finding) => ({
    code: `profile-${finding.code}`,
    ...fail('block', finding.message, command),
  }));
}

/**
 * The readiness settings, from `ready.*` in the research policy. A threshold that is not a
 * percentage falls back to the default rather than deciding the verdict by accident; a
 * `require` that is not a list means the researcher has not chosen, so all of them run.
 * @param {object|null} policy - the parsed `.phdude/research-policy.yaml`
 * @returns {{minHealth: number, require: string[]}}
 */
export function readyPolicy(policy) {
  const configured = policy?.ready ?? null;
  const threshold = configured?.min_health;
  const usable =
    typeof threshold === 'number' &&
    Number.isFinite(threshold) &&
    threshold >= 0 &&
    threshold <= 100;
  const listed = configured?.require;

  return {
    minHealth: usable ? threshold : DEFAULT_MIN_HEALTH,
    require: Array.isArray(listed)
      ? listed.filter((key) => typeof key === 'string')
      : [...REQUIREMENTS],
  };
}

/**
 * Pure. The submission-readiness verdict (spec §3.4).
 *
 * Every check runs; a failure carries the severity of what it found, and `lite` reports only the
 * `block`-severity ones while still listing the rest as relaxed, so a lighter mode never hides a
 * finding, it only stops blocking on it.
 *
 * @param {object} snapshot - a workspace snapshot; `citations` carries the `cite check` findings
 *   the application resolved (both optional, as in `health`)
 * @param {object|null} policy - the parsed research policy, read for `ready.*` and `health.weights`
 * @param {{profile?: object|null, mode?: string}} [options] - the resolved venue profile, and
 *   the workspace review mode
 * @returns {{ready: boolean, mode: string, profile: string|null,
 *   health: {overall: number|null, min: number}, checks: object[],
 *   blocking: {code: string, message: string, command: string}[],
 *   relaxed: {code: string, message: string, command: string}[], warnings: string[]}}
 */
export function ready(snapshot, policy, { profile = null, mode = 'full' } = {}) {
  const { minHealth: threshold, require } = readyPolicy(policy);
  const required = new Set(require.filter((key) => REQUIREMENTS.includes(key)));

  const warnings = [...new Set(require.filter((key) => !REQUIREMENTS.includes(key)))]
    .sort()
    .map((key) => `unknown requirement in ready.require: ${key}`);
  if (profile === null) {
    warnings.push('no venue profile is targeted, so the venue rules were not checked');
  }

  const report = health(snapshot, policy);
  const conflicts = detectFactConflicts(snapshot.facts ?? [], snapshot.decisions ?? []);
  const context = {
    conflicts,
    gaps: findGaps(snapshot, conflicts),
    promote: promoteSeverity(mode),
    overall: report.overall,
    threshold,
    required,
  };

  const checks = [
    ...profileChecks(snapshot, profile),
    ...REQUIREMENTS.filter((key) => required.has(key)).map((key) => ({
      code: key,
      ...BUILDERS[key](snapshot, context),
    })),
    { code: 'min-health', ...minHealth(snapshot, context) },
    { code: 'gaps-high', ...highGaps(snapshot, context) },
  ];

  const item = ({ code, message, command }) => ({ code, message, command });
  const failed = checks.filter((entry) => !entry.ok);
  const blocking = mode === 'lite' ? failed.filter((e) => e.severity === 'block') : failed;
  const relaxed = mode === 'lite' ? failed.filter((e) => e.severity !== 'block') : [];

  return {
    ready: blocking.length === 0,
    mode,
    profile: profile?.name ?? null,
    health: { overall: report.overall, min: threshold },
    checks,
    blocking: blocking.map(item),
    relaxed: relaxed.map(item),
    warnings,
  };
}
