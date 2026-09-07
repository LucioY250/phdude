import test from 'node:test';
import assert from 'node:assert/strict';
import { citationsGate, citationsIn } from '../../../../src/domain/gates/citations.js';
import { runGates } from '../../../../src/domain/gates/index.js';

function ctx({ sources = [], bibkeys = {}, dismissed = {} } = {}) {
  return {
    sourcesById: new Map(sources.map((id) => [id, { id }])),
    sourcesByBibkey: new Map(Object.entries(bibkeys).map(([key, id]) => [key, { id }])),
    dismissedSources: new Map(Object.entries(dismissed)),
  };
}

test('citationsIn locates every citation with its line number', () => {
  const text = 'One [@smith2020adoption].\n\nTwo [@SRC-0123456789] and [@jones2019survey].\n';
  assert.deepEqual(citationsIn(text), [
    { key: 'smith2020adoption', line: 1 },
    { key: 'SRC-0123456789', line: 3 },
    { key: 'jones2019survey', line: 3 },
  ]);
});

test('a citation resolves by bibkey', () => {
  const findings = citationsGate.run(
    'SMEs adopt AI slowly [@smith2020adoption].\n',
    ctx({ sources: ['SRC-0123456789'], bibkeys: { smith2020adoption: 'SRC-0123456789' } }),
  );
  assert.deepEqual(findings, []);
});

test('a citation resolves by source id', () => {
  const findings = citationsGate.run(
    'SMEs adopt AI slowly [@SRC-0123456789].\n',
    ctx({ sources: ['SRC-0123456789'], bibkeys: { smith2020adoption: 'SRC-0123456789' } }),
  );
  assert.deepEqual(findings, []);
});

test('an unresolved citation blocks, and says where it is', () => {
  const findings = citationsGate.run(
    '# Introduction\n\nA claim [@nobody2000nothing].\n',
    ctx({ sources: ['SRC-0123456789'], bibkeys: { smith2020adoption: 'SRC-0123456789' } }),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].gate, 'gate-citations');
  assert.equal(findings[0].severity, 'block');
  assert.equal(findings[0].line, 3);
  assert.match(findings[0].message, /nobody2000nothing/);
  assert.ok(findings[0].hint);
});

test('every occurrence of an unresolved key is located separately', () => {
  const findings = citationsGate.run('[@ghost]\n\n[@ghost]\n', ctx());
  assert.deepEqual(
    findings.map((f) => f.line),
    [1, 3],
  );
});

test('citing a source whose accepting candidate was dismissed blocks', () => {
  const findings = citationsGate.run(
    'Contested [@smith2020adoption].\n',
    ctx({
      sources: ['SRC-0123456789'],
      bibkeys: { smith2020adoption: 'SRC-0123456789' },
      dismissed: { 'SRC-0123456789': 'CAND-9876543210' },
    }),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'block');
  assert.match(findings[0].message, /CAND-9876543210/);
});

test('text with no citations produces no findings', () => {
  assert.deepEqual(citationsGate.run('Plain prose, no citations.\n', ctx()), []);
});

test('runGates aggregates findings and reports which gate blocked', () => {
  const noisy = {
    name: 'gate-noisy',
    run: () => [{ gate: 'gate-noisy', severity: 'warn', line: 1, message: 'm', hint: null }],
  };
  const result = runGates('A claim [@ghost].\n', ctx(), { gates: [citationsGate, noisy] });
  assert.equal(result.blocked, true);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.gates, [
    { gate: 'gate-citations', findings: 1, blocked: true },
    { gate: 'gate-noisy', findings: 1, blocked: false },
  ]);
});

test('runGates on clean text is not blocked', () => {
  const result = runGates('Plain prose.\n', ctx(), { gates: [citationsGate] });
  assert.deepEqual(result, {
    findings: [],
    blocked: false,
    scores: {},
    gates: [{ gate: 'gate-citations', findings: 0, blocked: false }],
  });
});

test('every key in a Pandoc bracket group is a citation', () => {
  assert.deepEqual(citationsIn('Both agree [@smith2020; @jones2019].\n'), [
    { key: 'smith2020', line: 1 },
    { key: 'jones2019', line: 1 },
  ]);
  assert.deepEqual(citationsIn('A locator [@smith2020, p. 3].\n'), [{ key: 'smith2020', line: 1 }]);
  assert.deepEqual(citationsIn('A prefix [see @smith2020].\n'), [{ key: 'smith2020', line: 1 }]);
  assert.deepEqual(citationsIn('Both [see also @a, pp. 4-5; @b, ch. 2].\n'), [
    { key: 'a', line: 1 },
    { key: 'b', line: 1 },
  ]);
});

test('a key keeps its internal punctuation and loses its trailing punctuation', () => {
  assert.deepEqual(citationsIn('[@smith2020.]\n[@a.b-c_d]\n'), [
    { key: 'smith2020', line: 1 },
    { key: 'a.b-c_d', line: 2 },
  ]);
});

test('an @ outside a bracket group is not a citation', () => {
  assert.deepEqual(citationsIn('Write to a.researcher@example.org about it.\n'), []);
  assert.deepEqual(citationsIn('A markdown [link](https://example.org) and text.\n'), []);
});

test('a group with several keys locates and audits each one', () => {
  const findings = citationsGate.run(
    'Both agree [@smith2020adoption; @ghost].\n',
    ctx({ sources: ['SRC-0123456789'], bibkeys: { smith2020adoption: 'SRC-0123456789' } }),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /\[@ghost\]/);
  assert.equal(findings[0].line, 1);
});
