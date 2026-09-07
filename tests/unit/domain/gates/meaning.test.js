import test from 'node:test';
import assert from 'node:assert/strict';
import { diff, meaningGate, signature } from '../../../../src/domain/gates/meaning.js';

const ORIGINAL = [
  'Adoption is not uniform across the 312 firms we surveyed [@smith2020].',
  '<!-- claim: CLAIM-1111111111 -->',
  '',
  'A second paragraph reports the replication [@jones2019].',
].join('\n');

function run(oldText, newText, options = {}) {
  return meaningGate.run(newText, { revisionOf: oldText, ...options });
}

test('a signature is the multiset of claims, citations, numerals and negation cues', () => {
  const sig = signature(ORIGINAL, 'en');
  assert.deepEqual([...sig.claims], [['CLAIM-1111111111', 1]]);
  assert.deepEqual([...sig.citations].sort(), [
    ['jones2019', 1],
    ['smith2020', 1],
  ]);
  assert.deepEqual([...sig.numerals], [['312', 1]]);
  assert.deepEqual([...sig.negations], [['not', 1]]);
});

test('rewording a sentence changes nothing the gate measures', () => {
  const revised = [
    'Across the 312 firms we surveyed, adoption is not uniform [@smith2020].',
    '<!-- claim: CLAIM-1111111111 -->',
    '',
    'The replication is reported in a second paragraph [@jones2019].',
  ].join('\n');
  assert.deepEqual(run(ORIGINAL, revised), []);
});

test('with nothing to revise against the gate reports nothing at all', () => {
  assert.deepEqual(meaningGate.run('anything', {}), []);
  assert.deepEqual(meaningGate.run('anything', { revisionOf: null }), []);
});

test('dropping a citation blocks and names the key', () => {
  const findings = run(ORIGINAL, ORIGINAL.replace(' [@jones2019]', ''));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'block');
  assert.equal(findings[0].gate, 'gate-meaning');
  assert.match(findings[0].message, /drops the citation jones2019/);
});

test('dropping a claim marker, a number or a negation each blocks', () => {
  const cases = [
    ['<!-- claim: CLAIM-1111111111 -->\n', /drops the claim CLAIM-1111111111/],
    ['312 ', /drops the number 312/],
    ['not ', /drops the negation not/],
  ];
  for (const [removed, message] of cases) {
    const findings = run(ORIGINAL, ORIGINAL.replace(removed, ''));
    assert.equal(findings.length, 1, removed);
    assert.equal(findings[0].severity, 'block');
    assert.match(findings[0].message, message);
  }
});

test('losing one of two identical numbers blocks: the multiset counts', () => {
  const twice = 'We surveyed 312 firms, then 312 again [@smith2020].';
  const once = 'We surveyed 312 firms [@smith2020].';
  assert.deepEqual(
    run(twice, once).map((f) => f.message),
    ['the revision drops the number 312'],
  );
});

test('an added claim or citation blocks, and --allow-additions lets it through', () => {
  const added = ORIGINAL + '\n\nA third point [@lopez2023].\n<!-- claim: CLAIM-2222222222 -->';
  const findings = run(ORIGINAL, added);
  assert.deepEqual(
    findings.map((f) => f.severity),
    ['block', 'block'],
  );
  assert.match(findings[0].message, /asserts a claim the section did not assert/);
  assert.match(findings[1].message, /cites a source the section did not cite/);

  assert.deepEqual(run(ORIGINAL, added, { allowAdditions: true }), []);
});

test('diff reports both directions', () => {
  const changed = 'A different sentence [@lopez2023].';
  const result = diff(ORIGINAL, changed, 'en');
  assert.deepEqual(result.removed.citations, ['jones2019', 'smith2020']);
  assert.deepEqual(result.removed.claims, ['CLAIM-1111111111']);
  assert.deepEqual(result.removed.numerals, ['312']);
  assert.deepEqual(result.removed.negations, ['not']);
  assert.deepEqual(result.added.citations, ['lopez2023']);
});

test('Spanish negation cues are counted with the Spanish table', () => {
  const before = 'La adopción no es uniforme [@smith2020].';
  const after = 'La adopción es uniforme [@smith2020].';
  assert.match(run(before, after, { lang: 'es' })[0].message, /drops the negation no/);
});
