import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkProfile,
  checkSection,
  orderedSections,
  sectionLimit,
  summarize,
} from '../../../src/domain/profiles.js';
import { profileGate } from '../../../src/domain/gates/profile.js';

const PROFILE = {
  schema: 'phdude.profile',
  version: 1,
  name: 'tiny-venue',
  display: 'Tiny Venue',
  document_class: 'article',
  citation_style: 'csl/tiny.csl',
  sections: [
    { id: 'abstract', title: 'Abstract', required: true, order: 1 },
    { id: 'introduction', title: 'Introduction', required: true, order: 2, max_words: 10 },
    { id: 'appendix', title: 'Appendix', required: false, order: 3 },
  ],
  abstract: { max_words: 5 },
  figures: { formats: ['pdf', 'png'] },
  tables: { style: 'booktabs' },
  references: { style: 'Tiny' },
  writing: { first_person: 'never' },
};

// A venue a workspace wrote for itself: four sections where a manuscript has three, one of them
// a section this venue has never heard of. Nothing about a manuscript has to line up with it.
const CUSTOM_VENUE = {
  schema: 'phdude.profile',
  version: 1,
  name: 'short-report',
  display: 'Short Report',
  document_class: 'article',
  citation_style: 'csl/short.csl',
  sections: [
    { id: 'abstract', title: 'Abstract', required: true, order: 1 },
    { id: 'findings', title: 'Findings', required: true, order: 2, max_words: 8 },
    { id: 'method', title: 'Method', required: false, order: 3 },
    { id: 'appendix', title: 'Appendix', required: false, order: 4 },
  ],
  abstract: { max_words: 5 },
  figures: { formats: ['pdf'] },
  tables: { style: 'booktabs' },
  references: { style: 'Short' },
  writing: { first_person: 'never' },
};

// Four sections the venue takes but does not require, so a manuscript can hold any subset of
// them in any order and the order rule is the only one with anything to say.
const ORDER_VENUE = {
  ...CUSTOM_VENUE,
  name: 'order-venue',
  sections: [
    { id: 'a', title: 'A', required: false, order: 1 },
    { id: 'b', title: 'B', required: false, order: 2 },
    { id: 'c', title: 'C', required: false, order: 3 },
    { id: 'd', title: 'D', required: false, order: 4 },
  ],
};

const VENUE_IDS = ['a', 'b', 'c', 'd'];

function orderFindings(entries, profile = ORDER_VENUE) {
  return checkProfile(manuscriptOf(entries.map((id) => ({ id }))), [], profile).filter(
    (finding) => finding.code === 'section-order',
  );
}

function manuscriptOf(entries) {
  return {
    schema: 'phdude.manuscript',
    version: 1,
    title: 'A manuscript',
    language: 'en',
    voice: { kind: 'consensus' },
    target_profile: 'tiny-venue',
    sections: entries.map((entry, index) => ({
      id: entry.id,
      title: entry.id,
      file: `manuscript/${entry.id}.md`,
      order: entry.order ?? index + 1,
      status: entry.status ?? 'approved',
      hash: null,
      claims: [],
      questions: [],
    })),
  };
}

const codes = (findings) => findings.map((finding) => finding.code);

test('orderedSections sorts by the order the venue declares, not by array position', () => {
  const shuffled = {
    ...PROFILE,
    sections: [PROFILE.sections[2], PROFILE.sections[0], PROFILE.sections[1]],
  };
  assert.deepEqual(
    orderedSections(shuffled).map((section) => section.id),
    ['abstract', 'introduction', 'appendix'],
  );
  assert.deepEqual(orderedSections({}), []);
});

test('the abstract inherits its limit from abstract.max_words, every other section from its own', () => {
  const [abstract, introduction, appendix] = orderedSections(PROFILE);
  assert.equal(sectionLimit(PROFILE, abstract), 5);
  assert.equal(sectionLimit(PROFILE, introduction), 10);
  assert.equal(sectionLimit(PROFILE, appendix), null);
});

test("a section's own max_words wins over the profile-wide abstract limit", () => {
  const profile = {
    ...PROFILE,
    sections: [{ id: 'abstract', title: 'Abstract', required: true, order: 1, max_words: 40 }],
  };
  assert.equal(sectionLimit(profile, profile.sections[0]), 40);
});

test('checkSection warns on a section the venue does not list', () => {
  const unknown = checkSection(PROFILE, { section: 'related-work', text: 'x' });
  assert.deepEqual(codes(unknown), ['section-unknown']);
  assert.equal(unknown[0].severity, 'warn');
  assert.match(unknown[0].hint, /abstract, introduction, appendix/);

  assert.deepEqual(checkSection(PROFILE, { section: 'introduction', text: 'short' }), []);
});

test('checkSection blocks a section over its word limit, counting the body without markers', () => {
  const overLimit = checkSection(PROFILE, {
    section: 'abstract',
    text: 'one two three four five six',
  });
  assert.deepEqual(codes(overLimit), ['section-words']);
  assert.equal(overLimit[0].severity, 'block');
  assert.match(overLimit[0].message, /6 words exceeds the 5-word limit/);

  // The same six words with two of them inside a citation and a claim marker: four count.
  const withMarkers = checkSection(PROFILE, {
    section: 'abstract',
    text: 'one two three four [@five] <!-- claim: CLAIM-abc -->',
  });
  assert.deepEqual(withMarkers, []);
});

test('checkSection is silent when the section has no text to measure yet', () => {
  assert.deepEqual(checkSection(PROFILE, { section: 'abstract', text: null }), []);
});

test('checkProfile blocks a missing required section and only informs about a missing optional one', () => {
  const findings = checkProfile(
    manuscriptOf([{ id: 'introduction' }]),
    [{ id: 'introduction', body: 'short enough' }],
    PROFILE,
  );

  const missing = findings.find((f) => f.code === 'section-missing');
  assert.equal(missing.severity, 'block');
  assert.equal(missing.section, 'abstract');
  assert.match(missing.message, /requires an abstract section/i);

  const optional = findings.find((f) => f.code === 'section-optional');
  assert.equal(optional.severity, 'info');
  assert.equal(optional.section, 'appendix');
});

test('checkProfile reports a required section that has no prose yet as info, not as missing', () => {
  const findings = checkProfile(
    manuscriptOf([
      { id: 'abstract', status: 'planned' },
      { id: 'introduction', status: 'planned' },
      { id: 'appendix', status: 'planned' },
    ]),
    [],
    PROFILE,
  );
  const unwritten = findings.filter((f) => f.code === 'section-unwritten');
  assert.deepEqual(
    unwritten.map((f) => f.section),
    ['abstract', 'introduction'],
  );
  for (const finding of unwritten) assert.equal(finding.severity, 'info');
  assert.equal(
    findings.some((f) => f.code === 'section-missing'),
    false,
  );
});

test('checkProfile carries every per-section finding out, tagged with its section', () => {
  const findings = checkProfile(
    manuscriptOf([{ id: 'abstract' }, { id: 'introduction' }, { id: 'appendix' }]),
    [
      { id: 'abstract', body: 'one two three four five six seven' },
      { id: 'introduction', body: 'still short' },
      { id: 'appendix', body: 'anything' },
    ],
    PROFILE,
  );
  const words = findings.find((f) => f.code === 'section-words');
  assert.equal(words.section, 'abstract');
  assert.equal(words.severity, 'block');
});

test("a subset of the venue's sections, in the venue's order, is in order", () => {
  for (let mask = 1; mask < 1 << VENUE_IDS.length; mask += 1) {
    const subset = VENUE_IDS.filter((_, index) => (mask >> index) & 1);
    assert.deepEqual(orderFindings(subset), [], subset.join(', '));
  }
});

test('any two sections swapped is one warning naming both of them', () => {
  for (let i = 0; i < VENUE_IDS.length; i += 1) {
    for (let j = i + 1; j < VENUE_IDS.length; j += 1) {
      const swapped = [...VENUE_IDS];
      swapped[i] = VENUE_IDS[j];
      swapped[j] = VENUE_IDS[i];

      const findings = orderFindings(swapped);
      assert.equal(findings.length, 1, swapped.join(', '));
      assert.equal(findings[0].severity, 'warn');
      assert.match(findings[0].message, new RegExp(`\\b${VENUE_IDS[i]}\\b`));
      assert.match(findings[0].message, new RegExp(`\\b${VENUE_IDS[j]}\\b`));
    }
  }
});

test('a section the venue does not list holds no place in the order it asks for', () => {
  assert.deepEqual(orderFindings(['a', 'zz', 'b', 'yy', 'c']), []);

  const findings = checkProfile(
    manuscriptOf([{ id: 'a' }, { id: 'zz' }, { id: 'b' }]),
    [],
    ORDER_VENUE,
  );
  assert.deepEqual(
    findings.filter((f) => f.code === 'section-unknown').map((f) => f.section),
    ['zz'],
  );
});

test('a section the manuscript never created leaves no gap for the rest to fall into', () => {
  const findings = checkProfile(
    manuscriptOf([{ id: 'abstract' }, { id: 'appendix' }]),
    [
      { id: 'abstract', body: 'tiny' },
      { id: 'appendix', body: 'tiny' },
    ],
    PROFILE,
  );

  const missing = findings.find((f) => f.code === 'section-missing');
  assert.equal(missing.section, 'introduction');
  assert.deepEqual(
    findings.filter((f) => f.code === 'section-order'),
    [],
  );
});

test('a custom venue and a manuscript need not line up, and both readers say the same thing', () => {
  const manuscript = manuscriptOf([{ id: 'abstract' }, { id: 'findings' }, { id: 'discussion' }]);
  const sections = [
    { id: 'abstract', body: 'one two three' },
    { id: 'findings', body: 'one two three four five six seven eight nine' },
    { id: 'discussion', body: 'anything at all' },
  ];

  const findings = checkProfile(manuscript, sections, CUSTOM_VENUE);
  assert.deepEqual(
    findings.filter((f) => f.code === 'section-order'),
    [],
  );
  assert.deepEqual(
    findings.filter((f) => f.code === 'section-optional').map((f) => f.section),
    ['method', 'appendix'],
  );

  for (const entry of manuscript.sections) {
    const { body } = sections.find((section) => section.id === entry.id);
    assert.deepEqual(
      profileGate
        .run(body, { venueProfile: CUSTOM_VENUE, section: entry.id })
        .map((f) => f.message),
      findings.filter((f) => f.section === entry.id).map((f) => f.message),
      entry.id,
    );
  }
});

test('the custom venue reports two of its sections reversed, which one section cannot see', () => {
  const manuscript = manuscriptOf([{ id: 'findings' }, { id: 'abstract' }, { id: 'discussion' }]);
  const sections = [
    { id: 'findings', body: 'one two three' },
    { id: 'abstract', body: 'one two three' },
    { id: 'discussion', body: 'anything at all' },
  ];

  const order = checkProfile(manuscript, sections, CUSTOM_VENUE).filter(
    (f) => f.code === 'section-order',
  );
  assert.equal(order.length, 1);
  assert.equal(order[0].severity, 'warn');
  assert.equal(order[0].section, null);
  assert.match(order[0].message, /puts abstract before findings/);

  for (const entry of manuscript.sections) {
    const { body } = sections.find((section) => section.id === entry.id);
    const gated = profileGate.run(body, { venueProfile: CUSTOM_VENUE, section: entry.id });
    assert.equal(
      gated.some((f) => f.message === order[0].message),
      false,
    );
  }
});

test('checkProfile warns about a figure in a format the venue does not take', () => {
  const manuscript = manuscriptOf([{ id: 'abstract' }, { id: 'introduction' }]);
  const sections = [
    { id: 'abstract', body: 'tiny' },
    { id: 'introduction', body: 'tiny' },
  ];
  const figures = [
    { id: 'FIG-1', name: 'only-svg', outputs: [{ path: 'figures/out/a.svg', format: 'svg' }] },
    { id: 'FIG-2', name: 'has-pdf', outputs: [{ path: 'figures/out/b.pdf', format: 'pdf' }] },
  ];

  const findings = checkProfile(manuscript, sections, PROFILE, { figures });
  const format = findings.filter((f) => f.code === 'figure-format');
  assert.equal(format.length, 1);
  assert.equal(format[0].severity, 'warn');
  assert.match(format[0].message, /only-svg/);
  assert.match(format[0].message, /pdf, png/);
});

test('checkProfile reports the reference style the venue sets, and warns when it sets none', () => {
  const manuscript = manuscriptOf([{ id: 'abstract' }, { id: 'introduction' }]);
  const sections = [
    { id: 'abstract', body: 'tiny' },
    { id: 'introduction', body: 'tiny' },
  ];

  const set = checkProfile(manuscript, sections, PROFILE).find(
    (f) => f.code === 'references-style',
  );
  assert.equal(set.severity, 'info');
  assert.match(set.message, /Tiny/);

  const without = { ...PROFILE, references: { style: '  ' } };
  const missing = checkProfile(manuscript, sections, without).find(
    (f) => f.code === 'references-style',
  );
  assert.equal(missing.severity, 'warn');
});

test('summarize counts findings by severity', () => {
  assert.deepEqual(
    summarize([
      { severity: 'block' },
      { severity: 'warn' },
      { severity: 'warn' },
      { severity: 'info' },
    ]),
    { block: 1, warn: 2, info: 1 },
  );
  assert.deepEqual(summarize([]), { block: 0, warn: 0, info: 0 });
});

test('findings come back in section order, so the report reads down the manuscript', () => {
  const findings = checkProfile(
    manuscriptOf([{ id: 'introduction' }, { id: 'abstract' }]),
    [
      { id: 'introduction', body: 'one two three four five six seven eight nine ten eleven' },
      { id: 'abstract', body: 'one two three four five six' },
    ],
    PROFILE,
  );
  assert.deepEqual(
    findings.filter((f) => f.code === 'section-words').map((f) => f.section),
    ['introduction', 'abstract'],
  );
});
