import test from 'node:test';
import assert from 'node:assert/strict';
import { outline, outlineSlides } from '../../../src/domain/outline.js';
import { PhdudeError } from '../../../src/domain/errors.js';

const MANUSCRIPT = {
  title: 'Coffee and Sleep',
  sections: [
    {
      id: 'introduction',
      title: 'Introduction',
      order: 1,
      status: 'approved',
      claims: ['CLAIM-aaaaaaaaaa'],
    },
    { id: 'methods', title: 'Methods', order: 2, status: 'draft', claims: [] },
    {
      id: 'results',
      title: 'Results',
      order: 3,
      status: 'approved',
      claims: ['CLAIM-bbbbbbbbbb'],
    },
    { id: 'discussion', title: 'Discussion', order: 4, status: 'approved', claims: [] },
  ],
};

const CLAIMS = [
  {
    id: 'CLAIM-aaaaaaaaaa',
    statement: 'Caffeine after 14:00 delays sleep onset.',
    state: 'canonical',
    supported_by: ['EVID-1111111111', 'EVID-2222222222', 'EVID-3333333333', 'EVID-4444444444'],
  },
  {
    id: 'CLAIM-bbbbbbbbbb',
    statement: 'The delay scales with dose.',
    state: 'supported',
    supported_by: ['EVID-5555555555'],
  },
  {
    id: 'CLAIM-cccccccccc',
    statement: 'Decaf has the same effect.',
    state: 'candidate',
    supported_by: [],
  },
];

const EVIDENCE = [
  {
    id: 'EVID-1111111111',
    excerpt: 'Onset was 28 minutes later in the caffeine arm.',
    strength: 'moderate',
    locator: 'p. 4',
    state: 'supported',
  },
  {
    id: 'EVID-2222222222',
    excerpt: 'A randomised trial of 312 adults found a 41-minute delay.',
    strength: 'strong',
    locator: 'p. 12',
    state: 'canonical',
  },
  { id: 'EVID-3333333333', excerpt: 'One participant reported no change.', strength: 'weak' },
  {
    id: 'EVID-4444444444',
    excerpt: 'A second trial replicated the delay.',
    strength: 'strong',
    state: 'supported',
  },
  { id: 'EVID-5555555555', excerpt: 'Each 100 mg added 9 minutes.', strength: 'moderate' },
];

const input = (over = {}) => ({
  manuscript: MANUSCRIPT,
  claims: CLAIMS,
  evidence: EVIDENCE,
  ...over,
});

test('a manuscript outline is one slide per approved section, in manuscript order', () => {
  const slides = outlineSlides(input());
  assert.deepEqual(
    slides.map((s) => s.title),
    ['Introduction', 'Results', 'Discussion'],
  );
});

test('the strongest evidence comes first and no slide carries more than three bullets', () => {
  const [intro] = outlineSlides(input());
  assert.equal(intro.bullets.length, 3);
  assert.match(intro.bullets[0], /randomised trial of 312 adults/);
  assert.match(intro.bullets[1], /second trial replicated/);
  assert.match(intro.bullets[2], /28 minutes later/);
  assert.ok(
    !intro.bullets.some((b) => b.includes('no change')),
    'the weakest evidence displaced a stronger one',
  );
});

test('a locator is carried with the excerpt it points into', () => {
  const [intro] = outlineSlides(input());
  assert.match(intro.bullets[0], /\(p\. 12\)$/);
  assert.doesNotMatch(intro.bullets[1], /\(/);
});

test('a section with nothing linked to it says so rather than showing an empty slide', () => {
  const slides = outlineSlides(input());
  const discussion = slides.at(-1);
  assert.deepEqual(discussion.bullets, ['(no evidence linked yet)']);
});

test('a claims outline is one slide per supported or canonical claim', () => {
  const slides = outlineSlides(input({ from: 'claims' }));
  assert.deepEqual(
    slides.map((s) => s.title),
    ['Caffeine after 14:00 delays sleep onset.', 'The delay scales with dose.'],
  );
  assert.deepEqual(slides[1].bullets, ['Each 100 mg added 9 minutes.']);
});

test('rejected evidence never reaches a slide', () => {
  const evidence = EVIDENCE.map((e) =>
    e.id === 'EVID-2222222222' ? { ...e, state: 'rejected' } : e,
  );
  const [intro] = outlineSlides(input({ evidence }));
  assert.ok(
    !intro.bullets.some((b) => b.includes('312 adults')),
    'a rejected evidence record was presented',
  );
});

test('a long excerpt is cut to one line the slide can hold', () => {
  const evidence = [
    {
      id: 'EVID-5555555555',
      excerpt: `First line.\n${'very long '.repeat(40)}end.`,
      strength: 'strong',
    },
  ];
  const slide = outlineSlides(input({ from: 'claims', evidence }))[1];
  assert.equal(slide.bullets[0].includes('\n'), false);
  assert.ok(slide.bullets[0].length <= 201, `bullet is ${slide.bullets[0].length} characters`);
  assert.match(slide.bullets[0], /…$/);
});

test('the Markdown is a title slide followed by one heading per slide', () => {
  const md = outline(input());
  assert.equal(
    md,
    [
      '# Coffee and Sleep',
      '',
      '## Introduction',
      '',
      '- A randomised trial of 312 adults found a 41-minute delay. (p. 12)',
      '- A second trial replicated the delay.',
      '- Onset was 28 minutes later in the caffeine arm. (p. 4)',
      '',
      '## Results',
      '',
      '- Each 100 mg added 9 minutes.',
      '',
      '## Discussion',
      '',
      '- (no evidence linked yet)',
      '',
    ].join('\n'),
  );
});

test('an outline with nothing approved to show is an error that says what to do', () => {
  const manuscript = {
    ...MANUSCRIPT,
    sections: MANUSCRIPT.sections.map((s) => ({ ...s, status: 'draft' })),
  };
  assert.throws(
    () => outline(input({ manuscript })),
    (err) => {
      assert.ok(err instanceof PhdudeError);
      assert.equal(err.code, 'VALIDATION');
      assert.match(err.hint, /--from claims/);
      return true;
    },
  );
});

test('an unknown source for the outline is a validation error', () => {
  assert.throws(() => outline(input({ from: 'vibes' })), PhdudeError);
});
