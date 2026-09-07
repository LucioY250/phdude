import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceGate } from '../../../../src/domain/gates/evidence.js';
import { markerInventory, markerCounts } from '../../../../src/domain/gates/markers.js';

// A workspace holding exactly the claims, evidence, facts and results a case needs.
function ctx({ claims = [], evidence = [], facts = [], results = [], lang = 'en' } = {}) {
  return {
    claimsById: new Map(claims.map((claim) => [claim.id, claim])),
    evidenceById: new Map(evidence.map((item) => [item.id, item])),
    factIds: new Set(facts),
    resultIds: new Set(results),
    lang,
  };
}

const SUPPORTED = {
  id: 'CLAIM-1111111111',
  state: 'supported',
  supported_by: ['EVID-1111111111'],
};
const MODERATE = { id: 'EVID-1111111111', strength: 'moderate' };
const WEAK = { id: 'EVID-2222222222', strength: 'weak' };

const world = ctx({ claims: [SUPPORTED], evidence: [MODERATE, WEAK] });

test('a paragraph whose claim marker resolves and whose verb fits the state is clean', () => {
  const text =
    'Adoption is associated with firm size [@smith2020].\n<!-- claim: CLAIM-1111111111 -->\n';
  assert.deepEqual(evidenceGate.run(text, world), []);
});

test('a claim marker that names nothing blocks, on its own line', () => {
  const findings = evidenceGate.run('One.\n\nTwo.\n<!-- claim: CLAIM-9999999999 -->\n', world);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'block');
  assert.equal(findings[0].line, 4);
  assert.match(findings[0].message, /CLAIM-9999999999 --> names no claim/);
});

test('a fact or result marker that names nothing blocks', () => {
  const findings = evidenceGate.run(
    'The sample was 312 <!-- fact: FACT-1111111111 --> and 40 <!-- result: RESULT-2222222222 -->.\n',
    ctx({ facts: ['FACT-1111111111'] }),
  );
  assert.deepEqual(
    findings.map((f) => [f.severity, f.message.includes('RESULT-2222222222')]),
    [['block', true]],
  );
});

test('asserting a rejected claim blocks', () => {
  const rejected = { id: 'CLAIM-3333333333', state: 'rejected', supported_by: [] };
  const findings = evidenceGate.run(
    'The effect is absent.\n<!-- claim: CLAIM-3333333333 -->\n',
    ctx({ claims: [rejected] }),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'block');
  assert.match(findings[0].message, /rejected and this paragraph asserts it/);
});

test('a candidate claim may suggest, and may not show, demonstrate, prove or establish', () => {
  const candidate = {
    id: 'CLAIM-4444444444',
    state: 'candidate',
    supported_by: ['EVID-1111111111'],
  };
  const world2 = ctx({ claims: [candidate], evidence: [MODERATE] });

  assert.deepEqual(
    evidenceGate.run('The survey suggests a lag.\n<!-- claim: CLAIM-4444444444 -->\n', world2),
    [],
  );

  for (const verb of ['shows', 'demonstrates', 'proves', 'establishes']) {
    const findings = evidenceGate.run(
      `The survey ${verb} a lag.\n<!-- claim: CLAIM-4444444444 -->\n`,
      world2,
    );
    assert.equal(findings.length, 1, verb);
    assert.equal(findings[0].severity, 'block');
    assert.match(findings[0].message, /is candidate/);
  }
});

test('a supported claim may show, and may not demonstrate or prove', () => {
  assert.deepEqual(
    evidenceGate.run('The survey shows a lag.\n<!-- claim: CLAIM-1111111111 -->\n', world),
    [],
  );
  for (const verb of ['demonstrates', 'proves']) {
    const findings = evidenceGate.run(
      `The survey ${verb} a lag.\n<!-- claim: CLAIM-1111111111 -->\n`,
      world,
    );
    assert.equal(findings.length, 1, verb);
    assert.match(findings[0].message, /is supported/);
  }
});

test('a claim resting on weak evidence alone may not show or demonstrate, whatever its state', () => {
  const thin = { id: 'CLAIM-5555555555', state: 'supported', supported_by: ['EVID-2222222222'] };
  const findings = evidenceGate.run(
    'The replication shows the same lag.\n<!-- claim: CLAIM-5555555555 -->\n',
    ctx({ claims: [thin], evidence: [WEAK] }),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'block');
  assert.match(findings[0].message, /rests on weak evidence only/);
});

test('a two-digit numeral with no marker and no citation warns, once, where it is', () => {
  const findings = evidenceGate.run('We surveyed 312 undergraduates.\n', ctx());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warn');
  assert.equal(findings[0].line, 1);
  assert.match(findings[0].message, /numeral 312/);
});

test('a numeral is spared by a marker, by a citation, or by being one digit', () => {
  const marked = 'We surveyed 312 <!-- fact: FACT-1111111111 --> undergraduates.\n';
  assert.deepEqual(evidenceGate.run(marked, ctx({ facts: ['FACT-1111111111'] })), []);
  assert.deepEqual(evidenceGate.run('We surveyed 312 undergraduates [@smith2020].\n', ctx()), []);
  assert.deepEqual(evidenceGate.run('We ran 3 waves.\n', ctx()), []);
});

test('the marker counts summarise what the prose rests on', () => {
  const text = [
    'The survey demonstrates a lag [@smith2020].',
    '<!-- claim: CLAIM-1111111111 -->',
    '',
    'A second paragraph reports 312 participants.',
    '<!-- claim: CLAIM-9999999999 -->',
  ].join('\n');
  const counts = markerCounts(markerInventory(text, world));
  assert.deepEqual(counts, {
    markers: 2,
    unresolved: 1,
    rejected: 0,
    overreach: 1,
    weaklySupported: 0,
    unmarkedNumerals: 1,
  });
});
