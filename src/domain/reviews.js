// Review objects (spec §3.2): what a reviewer said, stored as a record the researcher accepts,
// dismisses or resolves. A review is judgment, not knowledge - it carries no state from the
// knowledge lifecycle, only its own status - and it is the reviewer's words, so nothing here
// ever rewrites a stored severity. `promoteSeverity` is how `ruthless` bites: it is applied
// where a verdict is computed (`next`, `ready`), never where a review is written.

import { PhdudeError } from './errors.js';

export const REVIEW_KINDS = ['citation', 'methodology', 'reviewer2', 'reproducibility', 'custom'];
export const REVIEW_SEVERITIES = ['block', 'major', 'minor', 'note'];
export const REVIEW_STATUSES = ['open', 'accepted', 'dismissed', 'resolved'];

// `project` is the whole workspace and `manuscript:<section>` one section: neither is an
// entity, so neither can be looked up in the id registry.
export const PROJECT_TARGET = 'project';
export const MANUSCRIPT_TARGET_RE = /^manuscript:([a-z0-9]+(?:-[a-z0-9]+)*)$/;

// A finding is accepted, dismissed once, and resolved only after it was accepted: dismissing a
// finding you already accepted would erase the acceptance, and resolving one nobody accepted
// would close it without a verdict.
const TRANSITIONS = {
  open: ['accepted', 'dismissed'],
  accepted: ['resolved'],
  dismissed: [],
  resolved: [],
};

/**
 * @param {string} status
 * @returns {string[]} the statuses a review in `status` may move to
 */
export function nextStatuses(status) {
  return TRANSITIONS[status] ?? [];
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  return nextStatuses(from).includes(to);
}

const PROMOTED = { minor: 'major', major: 'block' };

/**
 * The `ruthless` mode (PRD §40) read as a function over severities. Stored reviews keep the
 * severity the reviewer wrote; this is applied at the point a verdict is computed, so changing
 * the mode changes the verdict without rewriting a single record.
 * @param {string|null|undefined} mode - the workspace review mode
 * @returns {(severity: string) => string}
 */
export function promoteSeverity(mode) {
  if (mode !== 'ruthless') return (severity) => severity;
  return (severity) => PROMOTED[severity] ?? severity;
}

/**
 * The open reviews that count as serious under a mode: `block` and `major` after promotion.
 * @param {object[]} reviews
 * @param {string|null|undefined} mode
 * @returns {object[]}
 */
export function seriousReviews(reviews, mode) {
  const promote = promoteSeverity(mode);
  return (reviews ?? []).filter(
    (review) => review.status === 'open' && ['block', 'major'].includes(promote(review.severity)),
  );
}

/**
 * @param {string} target
 * @param {{ids: Set<string>, sections: Set<string>}} known
 * @returns {boolean}
 */
export function targetExists(target, { ids, sections }) {
  if (target === PROJECT_TARGET) return true;
  const section = MANUSCRIPT_TARGET_RE.exec(String(target ?? ''));
  if (section) return sections.has(section[1]);
  return ids.has(target);
}

const FINDING_FIELDS = ['target', 'severity', 'message', 'evidence', 'suggested_command'];

function checkFinding(finding, index, known, problems) {
  const at = `findings[${index}]`;
  if (finding === null || typeof finding !== 'object' || Array.isArray(finding)) {
    problems.push(`${at} is not an object`);
    return null;
  }

  const unknown = Object.keys(finding).filter((key) => !FINDING_FIELDS.includes(key));
  if (unknown.length > 0) {
    problems.push(`${at} has unknown field(s): ${unknown.sort().join(', ')}`);
    return null;
  }

  const before = problems.length;

  if (typeof finding.target !== 'string' || !targetExists(finding.target, known)) {
    problems.push(
      `${at} unknown target ${JSON.stringify(finding.target ?? null)}: use an object id, ` +
        `manuscript:<section>, or project`,
    );
  }
  if (!REVIEW_SEVERITIES.includes(finding.severity)) {
    problems.push(
      `${at} severity ${JSON.stringify(finding.severity ?? null)} is not one of ` +
        REVIEW_SEVERITIES.join(', '),
    );
  }
  const message = typeof finding.message === 'string' ? finding.message.trim() : '';
  if (message === '') {
    problems.push(`${at} message must be a non-empty string`);
  }

  const evidence = finding.evidence ?? [];
  if (!Array.isArray(evidence) || evidence.some((id) => typeof id !== 'string')) {
    problems.push(`${at} evidence must be an array of ids`);
  } else {
    for (const id of evidence) {
      if (!known.ids.has(id)) problems.push(`${at} unknown evidence id ${id}`);
    }
  }

  if (finding.suggested_command !== undefined && typeof finding.suggested_command !== 'string') {
    problems.push(`${at} suggested_command must be a string`);
  }

  if (problems.length > before) return null;

  const normalized = { target: finding.target, severity: finding.severity, message, evidence };
  if (finding.suggested_command !== undefined) {
    normalized.suggested_command = finding.suggested_command;
  }
  return normalized;
}

/**
 * The findings contract an agent writes back (spec §3.2). Every problem is reported at once and
 * located by index: a reviewer handed one error at a time re-runs the whole review each round.
 * @param {object} payload - the parsed findings file
 * @param {{ids: Set<string>, sections: Set<string>}} known - the ids and manuscript sections a
 *   finding may name
 * @returns {{target: string, severity: string, message: string, evidence: string[],
 *   suggested_command?: string}[]}
 * @throws {PhdudeError} VALIDATION, with one detail per problem
 */
export function validateFindings(payload, known) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PhdudeError(
      'VALIDATION',
      'the findings file must be a JSON object',
      'it looks like {"findings": [{"target": "…", "severity": "…", "message": "…", "evidence": []}]}',
    );
  }
  if (!Array.isArray(payload.findings)) {
    throw new PhdudeError(
      'VALIDATION',
      'the findings file has no "findings" array',
      'it looks like {"findings": [{"target": "…", "severity": "…", "message": "…", "evidence": []}]}',
    );
  }

  const problems = [];
  const normalized = [];
  payload.findings.forEach((finding, index) => {
    const checked = checkFinding(finding, index, known, problems);
    if (checked) normalized.push(checked);
  });

  if (problems.length > 0) {
    throw new PhdudeError(
      'VALIDATION',
      `${problems.length} finding problem(s) in the submitted file`,
      'every finding names a target that exists, a severity, a message, and only ids the workspace records',
      problems,
    );
  }
  return normalized;
}
