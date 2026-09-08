import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_KINDS,
  REVIEW_SEVERITIES,
  REVIEW_STATUSES,
  canTransition,
  nextStatuses,
  promoteSeverity,
  seriousReviews,
  validateFindings,
} from '../../../src/domain/reviews.js';
import { PhdudeError } from '../../../src/domain/errors.js';

const IDS = new Set(['CLAIM-aaaaaaaaaa', 'EVID-bbbbbbbbbb', 'SRC-cccccccccc']);
const SECTIONS = new Set(['results', 'discussion']);

function findings(...items) {
  return { findings: items };
}

function ok(payload) {
  return validateFindings(payload, { ids: IDS, sections: SECTIONS });
}

function rejects(payload, pattern) {
  assert.throws(
    () => ok(payload),
    (err) => {
      assert.ok(err instanceof PhdudeError, 'a typed error');
      assert.equal(err.code, 'VALIDATION');
      assert.ok(Array.isArray(err.details) && err.details.length > 0, 'the details locate it');
      assert.ok(
        err.details.some((detail) => pattern.test(detail)),
        `expected a detail matching ${pattern}, got ${JSON.stringify(err.details)}`,
      );
      return true;
    },
  );
}

test('the vocabularies are the ones the schema and the spec name', () => {
  assert.deepEqual(REVIEW_KINDS, [
    'citation',
    'methodology',
    'reviewer2',
    'reproducibility',
    'custom',
  ]);
  assert.deepEqual(REVIEW_SEVERITIES, ['block', 'major', 'minor', 'note']);
  assert.deepEqual(REVIEW_STATUSES, ['open', 'accepted', 'dismissed', 'resolved']);
});

test('an open review may be accepted or dismissed, and only an accepted one resolved', () => {
  assert.deepEqual(nextStatuses('open'), ['accepted', 'dismissed']);
  assert.deepEqual(nextStatuses('accepted'), ['resolved']);
  assert.deepEqual(nextStatuses('dismissed'), []);
  assert.deepEqual(nextStatuses('resolved'), []);

  assert.equal(canTransition('open', 'accepted'), true);
  assert.equal(canTransition('open', 'dismissed'), true);
  assert.equal(canTransition('open', 'resolved'), false);
  assert.equal(canTransition('accepted', 'resolved'), true);
  assert.equal(canTransition('accepted', 'dismissed'), false);
  assert.equal(canTransition('dismissed', 'accepted'), false);
  assert.equal(canTransition('resolved', 'accepted'), false);
  assert.equal(canTransition('nonsense', 'accepted'), false);
});

test('ruthless promotes minor to major and major to block, and leaves block and note alone', () => {
  const promote = promoteSeverity('ruthless');
  assert.equal(promote('note'), 'note');
  assert.equal(promote('minor'), 'major');
  assert.equal(promote('major'), 'block');
  assert.equal(promote('block'), 'block');
});

for (const mode of ['lite', 'full', 'off', undefined, null, 'nonsense']) {
  test(`promoteSeverity(${JSON.stringify(mode)}) leaves every severity as the reviewer wrote it`, () => {
    const promote = promoteSeverity(mode);
    for (const severity of REVIEW_SEVERITIES) assert.equal(promote(severity), severity);
  });
}

test('seriousReviews counts what blocks under the mode, never rewriting the stored severity', () => {
  const reviews = [
    { id: 'REVIEW-1111111111', status: 'open', severity: 'minor' },
    { id: 'REVIEW-2222222222', status: 'open', severity: 'major' },
    { id: 'REVIEW-3333333333', status: 'open', severity: 'note' },
    { id: 'REVIEW-4444444444', status: 'accepted', severity: 'block' },
  ];

  assert.deepEqual(
    seriousReviews(reviews, 'full').map((r) => r.id),
    ['REVIEW-2222222222'],
  );
  assert.deepEqual(
    seriousReviews(reviews, 'ruthless').map((r) => r.id),
    ['REVIEW-1111111111', 'REVIEW-2222222222'],
  );
  assert.equal(reviews[0].severity, 'minor', 'the stored severity is untouched');
});

test('validateFindings accepts a well-formed findings file and fills the optional fields', () => {
  const result = ok(
    findings(
      {
        target: 'CLAIM-aaaaaaaaaa',
        severity: 'major',
        message: 'The comparison group is never described.',
        evidence: ['EVID-bbbbbbbbbb'],
        suggested_command: 'phdude knowledge show CLAIM-aaaaaaaaaa',
      },
      { target: 'project', severity: 'note', message: 'No preregistration is recorded.' },
      { target: 'manuscript:results', severity: 'block', message: 'The effect size is asserted.' },
    ),
  );

  assert.equal(result.length, 3);
  assert.deepEqual(result[0].evidence, ['EVID-bbbbbbbbbb']);
  assert.equal(result[0].suggested_command, 'phdude knowledge show CLAIM-aaaaaaaaaa');
  assert.deepEqual(result[1].evidence, [], 'evidence defaults to none');
  assert.equal(result[1].suggested_command, undefined, 'no command is invented');
  assert.equal(result[2].target, 'manuscript:results');
});

test('validateFindings trims the message and keeps the finding order', () => {
  const result = ok(
    findings(
      { target: 'project', severity: 'note', message: '  second thoughts  ' },
      { target: 'project', severity: 'note', message: 'first thoughts' },
    ),
  );
  assert.deepEqual(
    result.map((f) => f.message),
    ['second thoughts', 'first thoughts'],
  );
});

test('validateFindings accepts an empty list: a reviewer who found nothing said so', () => {
  assert.deepEqual(ok(findings()), []);
});

test('validateFindings refuses anything that is not the findings contract', () => {
  for (const payload of [null, [], 'findings', 42, {}, { findings: {} }]) {
    assert.throws(
      () => ok(payload),
      (err) => {
        assert.equal(err.code, 'VALIDATION');
        return true;
      },
      `expected ${JSON.stringify(payload)} to be refused`,
    );
  }
});

test('validateFindings reports every problem at once, located by index', () => {
  assert.throws(
    () =>
      ok(
        findings(
          { target: 'CLAIM-9999999999', severity: 'major', message: 'gone' },
          { target: 'project', severity: 'critical', message: 'wrong severity' },
          { target: 'project', severity: 'note', message: '   ' },
        ),
      ),
    (err) => {
      assert.equal(err.details.length, 3);
      assert.match(err.details[0], /findings\[0\]/);
      assert.match(err.details[1], /findings\[1\]/);
      assert.match(err.details[2], /findings\[2\]/);
      return true;
    },
  );
});

test('validateFindings refuses a target that does not exist', () => {
  rejects(findings({ target: 'CLAIM-9999999999', severity: 'note', message: 'x' }), /unknown targ/);
  rejects(findings({ target: 'manuscript:intro', severity: 'note', message: 'x' }), /unknown targ/);
  rejects(findings({ target: 'whatever', severity: 'note', message: 'x' }), /unknown targ/);
});

test('validateFindings refuses evidence that does not exist', () => {
  rejects(
    findings({
      target: 'project',
      severity: 'note',
      message: 'x',
      evidence: ['EVID-bbbbbbbbbb', 'EVID-9999999999'],
    }),
    /unknown evidence id EVID-9999999999/,
  );
});

test('validateFindings refuses an unknown field rather than dropping it', () => {
  rejects(
    findings({ target: 'project', severity: 'note', message: 'x', confidence: 0.9 }),
    /unknown field\(s\): confidence/,
  );
});

test('validateFindings refuses a severity outside the enum', () => {
  rejects(findings({ target: 'project', severity: 'blocker', message: 'x' }), /severity/);
});

test('validateFindings refuses a non-string message, evidence or suggested_command', () => {
  rejects(findings({ target: 'project', severity: 'note', message: 42 }), /message/);
  rejects(
    findings({ target: 'project', severity: 'note', message: 'x', evidence: 'EVID-bbbbbbbbbb' }),
    /evidence/,
  );
  rejects(
    findings({ target: 'project', severity: 'note', message: 'x', suggested_command: ['ls'] }),
    /suggested_command/,
  );
});
