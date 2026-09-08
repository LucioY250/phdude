import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CITE_FINDING_SEVERITY,
  doiFindings,
  indexCandidates,
  offlineFindings,
  sortFindings,
} from '../../../src/domain/audit.js';

const SOURCE = {
  id: 'SRC-1111111111',
  schema: 'phdude.source',
  title: 'Adoption of AI in Small Firms',
  year: 2020,
  identifiers: { doi: '10.1234/adoption' },
};

const EVIDENCE = { id: 'EV-1111111111', source: SOURCE.id, strength: 'moderate' };

const CLAIM = {
  id: 'CLAIM-1111111111',
  statement: 'Small firms adopt AI more slowly.',
  supported_by: [EVIDENCE.id],
};

function input(overrides = {}) {
  return {
    sections: [],
    sourcesById: new Map([[SOURCE.id, SOURCE]]),
    sourcesByBibkey: new Map([['zeta2020', SOURCE]]),
    claimsById: new Map([[CLAIM.id, CLAIM]]),
    evidenceById: new Map([[EVIDENCE.id, EVIDENCE]]),
    candidateBySource: new Map(),
    citeFindings: [],
    ...overrides,
  };
}

function rules(findings) {
  return findings.map((finding) => finding.rule);
}

test('offline: a citation key that resolves to nothing blocks, and names its section', () => {
  const findings = offlineFindings(
    input({ sections: [{ id: 'introduction', text: 'A sentence [@ghost2019].' }] }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'unresolved-citation');
  assert.equal(findings[0].severity, 'block');
  assert.equal(findings[0].target, 'manuscript:introduction');
  assert.match(findings[0].message, /\[@ghost2019\]/);
  assert.match(findings[0].message, /introduction/);
});

test('offline: a key resolving by bibkey or by SRC id is not a finding', () => {
  const findings = offlineFindings(
    input({
      sections: [{ id: 'introduction', text: `One [@zeta2020], two [@${SOURCE.id}].` }],
    }),
  );

  assert.deepEqual(findings, []);
});

test('offline: the same unresolved key twice in one section is reported once', () => {
  const findings = offlineFindings(
    input({ sections: [{ id: 'introduction', text: '[@ghost2019] and again [@ghost2019].' }] }),
  );

  assert.equal(findings.length, 1);
});

test('offline: the same unresolved key in two sections is one finding per section', () => {
  const findings = offlineFindings(
    input({
      sections: [
        { id: 'introduction', text: '[@ghost2019].' },
        { id: 'discussion', text: '[@ghost2019].' },
      ],
    }),
  );

  assert.deepEqual(
    findings.map((finding) => finding.target),
    ['manuscript:discussion', 'manuscript:introduction'],
  );
});

test('offline: front matter is not prose, so a key inside it is never audited', () => {
  const text = ['---', 'section: introduction', 'cites: "[@ghost2019]"', '---', '', 'Body.'].join(
    '\n',
  );

  assert.deepEqual(offlineFindings(input({ sections: [{ id: 'introduction', text }] })), []);
});

test('offline: a claim asserted with no evidence citing a source is major', () => {
  const orphan = { id: 'CLAIM-2222222222', statement: 'Unbacked.', supported_by: [] };
  const findings = offlineFindings(
    input({
      claimsById: new Map([
        [CLAIM.id, CLAIM],
        [orphan.id, orphan],
      ]),
      sections: [{ id: 'results', text: `A sentence. <!-- claim: ${orphan.id} -->` }],
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'unsourced-claim');
  assert.equal(findings[0].severity, 'major');
  assert.equal(findings[0].target, 'manuscript:results');
  assert.deepEqual(findings[0].evidence, [orphan.id]);
  assert.match(findings[0].message, /results/);
});

test('offline: a claim whose evidence cites a raw artifact still counts as unsourced', () => {
  const artifactBacked = { id: 'EV-2222222222', source: 'ART-3333333333', strength: 'weak' };
  const claim = { id: 'CLAIM-3333333333', statement: 'x', supported_by: [artifactBacked.id] };
  const findings = offlineFindings(
    input({
      claimsById: new Map([[claim.id, claim]]),
      evidenceById: new Map([[artifactBacked.id, artifactBacked]]),
      sections: [{ id: 'results', text: `<!-- claim: ${claim.id} -->` }],
    }),
  );

  assert.deepEqual(rules(findings), ['unsourced-claim']);
});

test('offline: a claim with evidence citing a source is silent', () => {
  const findings = offlineFindings(
    input({ sections: [{ id: 'results', text: `<!-- claim: ${CLAIM.id} -->` }] }),
  );

  assert.deepEqual(findings, []);
});

test('offline: a claim marker naming nothing is left to the writing gates', () => {
  const findings = offlineFindings(
    input({ sections: [{ id: 'results', text: '<!-- claim: CLAIM-9999999999 -->' }] }),
  );

  assert.deepEqual(findings, []);
});

test('offline: a cited source whose candidate is still awaiting review is minor', () => {
  const candidate = { id: 'CAND-1111111111', state: 'candidate', title: SOURCE.title };
  const findings = offlineFindings(
    input({
      sections: [{ id: 'introduction', text: '[@zeta2020]' }],
      candidateBySource: new Map([[SOURCE.id, candidate]]),
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'unreviewed-source');
  assert.equal(findings[0].severity, 'minor');
  assert.equal(findings[0].target, SOURCE.id);
  assert.deepEqual(findings[0].evidence, [candidate.id]);
});

test('offline: a cited source whose candidate was dismissed is major', () => {
  const candidate = { id: 'CAND-1111111111', state: 'dismissed', reason: 'predatory venue' };
  const findings = offlineFindings(
    input({
      sections: [{ id: 'introduction', text: '[@zeta2020]' }],
      candidateBySource: new Map([[SOURCE.id, candidate]]),
    }),
  );

  assert.deepEqual(rules(findings), ['dismissed-source']);
  assert.equal(findings[0].severity, 'major');
});

test('offline: a source cited in two sections is flagged once, on the source', () => {
  const candidate = { id: 'CAND-1111111111', state: 'dismissed' };
  const findings = offlineFindings(
    input({
      sections: [
        { id: 'introduction', text: '[@zeta2020]' },
        { id: 'discussion', text: `[@${SOURCE.id}]` },
      ],
      candidateBySource: new Map([[SOURCE.id, candidate]]),
    }),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].target, SOURCE.id);
});

test('offline: a source with an accepted candidate is not flagged', () => {
  const candidate = { id: 'CAND-1111111111', state: 'accepted' };
  const findings = offlineFindings(
    input({
      sections: [{ id: 'introduction', text: '[@zeta2020]' }],
      candidateBySource: new Map([[SOURCE.id, candidate]]),
    }),
  );

  assert.deepEqual(findings, []);
});

test('offline: a candidate/dismissed source nobody cites is not the auditor’s business', () => {
  const candidate = { id: 'CAND-1111111111', state: 'dismissed' };
  const findings = offlineFindings(input({ candidateBySource: new Map([[SOURCE.id, candidate]]) }));

  assert.deepEqual(findings, []);
});

test('offline: every cite check finding becomes a finding at its own severity', () => {
  const citeFindings = [
    { kind: 'uncited-source', id: SOURCE.id, message: 'not cited', hint: 'phdude add evidence' },
    { kind: 'evidence-missing-source', id: EVIDENCE.id, message: 'dangling', hint: 'look it up' },
    { kind: 'invalid-doi', id: SOURCE.id, message: 'bad doi', hint: 'phdude edit SRC-…' },
  ];
  const findings = offlineFindings(input({ citeFindings }));

  assert.deepEqual(
    findings.map((finding) => [finding.rule, finding.severity, finding.target]),
    [
      ['cite:evidence-missing-source', 'block', EVIDENCE.id],
      ['cite:invalid-doi', 'major', SOURCE.id],
      ['cite:uncited-source', 'note', SOURCE.id],
    ],
  );
  assert.equal(findings[1].suggested_command, 'phdude edit SRC-…');
});

test('offline: a hint that is not a command is not offered as one', () => {
  const findings = offlineFindings(
    input({
      citeFindings: [
        {
          kind: 'evidence-missing-source',
          id: EVIDENCE.id,
          message: 'dangling',
          hint: 'look it up',
        },
      ],
    }),
  );

  assert.equal(findings[0].suggested_command, undefined);
});

test('offline: an unknown cite check kind is recorded as minor rather than dropped', () => {
  const findings = offlineFindings(
    input({ citeFindings: [{ kind: 'invented-later', id: SOURCE.id, message: 'something' }] }),
  );

  assert.equal(findings[0].severity, 'minor');
  assert.equal(CITE_FINDING_SEVERITY['invented-later'], undefined);
});

test('offline findings come back worst first, then by target', () => {
  const candidate = { id: 'CAND-1111111111', state: 'dismissed' };
  const findings = offlineFindings(
    input({
      sections: [{ id: 'introduction', text: '[@zeta2020] and [@ghost2019]' }],
      candidateBySource: new Map([[SOURCE.id, candidate]]),
      citeFindings: [{ kind: 'uncited-source', id: SOURCE.id, message: 'not cited' }],
    }),
  );

  assert.deepEqual(rules(findings), [
    'unresolved-citation',
    'dismissed-source',
    'cite:uncited-source',
  ]);
});

test('doi: a DOI Crossref does not know is major', () => {
  const findings = doiFindings(SOURCE, '10.1234/adoption', null);

  assert.deepEqual(rules(findings), ['doi-unresolved']);
  assert.equal(findings[0].severity, 'major');
  assert.equal(findings[0].target, SOURCE.id);
  assert.match(findings[0].message, /10\.1234\/adoption/);
});

test('doi: a matching title and year is silent', () => {
  const findings = doiFindings(SOURCE, '10.1234/adoption', {
    title: 'Adoption of AI in small firms',
    year: 2020,
    retracted: false,
  });

  assert.deepEqual(findings, []);
});

test('doi: a title below the similarity threshold is a major mismatch that quotes both', () => {
  const findings = doiFindings(SOURCE, '10.1234/adoption', {
    title: 'Groundwater recharge in arid basins',
    year: 2020,
    retracted: false,
  });

  assert.deepEqual(rules(findings), ['title-mismatch']);
  assert.equal(findings[0].severity, 'major');
  assert.match(findings[0].message, /Groundwater recharge in arid basins/);
});

test('doi: a year one out is within tolerance, two out is minor', () => {
  const record = { title: SOURCE.title, retracted: false };

  assert.deepEqual(doiFindings(SOURCE, '10.1234/adoption', { ...record, year: 2021 }), []);
  const findings = doiFindings(SOURCE, '10.1234/adoption', { ...record, year: 2022 });
  assert.deepEqual(rules(findings), ['year-mismatch']);
  assert.equal(findings[0].severity, 'minor');
  assert.match(findings[0].message, /2022/);
});

test('doi: a retraction blocks, and the other checks still run', () => {
  const findings = doiFindings(SOURCE, '10.1234/adoption', {
    title: 'Groundwater recharge in arid basins',
    year: 2020,
    retracted: true,
  });

  assert.deepEqual(rules(findings), ['retracted-source', 'title-mismatch']);
  assert.equal(findings[0].severity, 'block');
});

test('doi: a comparison the workspace cannot make is not a finding', () => {
  const untitled = { id: 'SRC-2222222222', title: '', identifiers: { doi: '10.1234/x' } };

  assert.deepEqual(doiFindings(untitled, '10.1234/x', { title: 'Anything', retracted: false }), []);
  assert.deepEqual(
    doiFindings(SOURCE, '10.1234/adoption', { title: SOURCE.title, year: null, retracted: false }),
    [],
  );
});

test('indexCandidates: the recorded link wins, a shared DOI is the fallback', () => {
  const linked = { id: 'CAND-1111111111', state: 'accepted', doi: '10.9999/other' };
  const byDoi = { id: 'CAND-2222222222', state: 'dismissed', doi: '10.1234/adoption' };
  const sources = [SOURCE, { id: 'SRC-2222222222', doi: '10.1234/adoption' }];

  const index = indexCandidates(
    [{ ...SOURCE, ext: { research: { candidate: linked.id } } }, sources[1]],
    [linked, byDoi],
  );

  assert.equal(index.get(SOURCE.id), linked);
  assert.equal(index.get('SRC-2222222222'), byDoi);
});

test('indexCandidates: a source no candidate describes is absent, not null', () => {
  const index = indexCandidates([SOURCE], []);

  assert.equal(index.has(SOURCE.id), false);
});

test('sortFindings does not mutate its input', () => {
  const findings = [
    { rule: 'b', severity: 'note', target: 'SRC-2', message: 'x' },
    { rule: 'a', severity: 'block', target: 'SRC-1', message: 'y' },
  ];
  const sorted = sortFindings(findings);

  assert.equal(findings[0].rule, 'b');
  assert.deepEqual(rules(sorted), ['a', 'b']);
});
