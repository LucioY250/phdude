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
    gates: [{ gate: 'gate-citations', findings: 0, blocked: false }],
  });
});
