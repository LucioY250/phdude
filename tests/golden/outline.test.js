import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outline } from '../../src/domain/outline.js';

const here = dirname(fileURLToPath(import.meta.url));
const EXPECTED = join(here, 'expected');

// The outline is pure, so the golden runs on a fixture rather than on the example workspace: it
// pins the exact bytes a slide, a bullet and a locator are made of, ordering included, without
// waiting for the example to grow an approved manuscript.
const MANUSCRIPT = {
  title: 'Caffeine and Sleep Onset',
  sections: [
    {
      id: 'introduction',
      title: 'Introduction',
      order: 1,
      status: 'approved',
      claims: ['CLAIM-1111111111'],
    },
    { id: 'methods', title: 'Methods', order: 2, status: 'draft', claims: [] },
    {
      id: 'results',
      title: 'Results',
      order: 3,
      status: 'approved',
      claims: ['CLAIM-2222222222'],
    },
    { id: 'discussion', title: 'Discussion', order: 4, status: 'approved', claims: [] },
  ],
};

const CLAIMS = [
  {
    id: 'CLAIM-1111111111',
    statement: 'Caffeine taken after 14:00 delays sleep onset.',
    state: 'canonical',
    supported_by: ['EVID-1111111111', 'EVID-2222222222', 'EVID-3333333333', 'EVID-4444444444'],
  },
  {
    id: 'CLAIM-2222222222',
    statement: 'The delay scales with the dose.',
    state: 'supported',
    supported_by: ['EVID-5555555555'],
  },
  {
    id: 'CLAIM-3333333333',
    statement: 'Decaffeinated coffee has the same effect.',
    state: 'candidate',
    supported_by: ['EVID-6666666666'],
  },
];

const EVIDENCE = [
  {
    id: 'EVID-1111111111',
    excerpt: 'Sleep onset was 28 minutes later in the caffeine arm.',
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
  {
    id: 'EVID-3333333333',
    excerpt: 'One participant reported no change at all.',
    strength: 'weak',
    state: 'candidate',
  },
  {
    id: 'EVID-4444444444',
    excerpt: 'A second trial replicated the delay in 210 adults.',
    strength: 'strong',
    locator: 'table 2',
    state: 'supported',
  },
  {
    id: 'EVID-5555555555',
    excerpt: 'Each additional 100 mg added nine minutes.',
    strength: 'moderate',
    locator: 'fig. 3',
    state: 'supported',
  },
  {
    id: 'EVID-6666666666',
    excerpt: 'Decaf drinkers slept as usual.',
    strength: 'weak',
    state: 'candidate',
  },
];

const GOLDEN = {
  'outline-manuscript.md': 'manuscript',
  'outline-claims.md': 'claims',
};

test('outline golden: both sources write exactly the committed bytes', async () => {
  for (const [file, from] of Object.entries(GOLDEN)) {
    const md = outline({ from, manuscript: MANUSCRIPT, claims: CLAIMS, evidence: EVIDENCE });
    const path = join(EXPECTED, file);
    if (process.env.UPDATE_GOLDEN) {
      await writeFile(path, md);
      continue;
    }
    assert.equal(md, await readFile(path, 'utf8'), `${file} drifted`);
  }
});

test('outline golden: the draft section and the candidate claim never reach a slide', async () => {
  if (process.env.UPDATE_GOLDEN) return;
  for (const file of Object.keys(GOLDEN)) {
    const md = await readFile(join(EXPECTED, file), 'utf8');
    assert.doesNotMatch(md, /Methods/, `${file} presented a draft section`);
    assert.doesNotMatch(md, /Decaf/, `${file} presented a candidate claim`);
  }
});

test('outline golden: the strongest evidence leads and only three bullets survive', async () => {
  if (process.env.UPDATE_GOLDEN) return;
  const md = await readFile(join(EXPECTED, 'outline-manuscript.md'), 'utf8');
  const intro = md.slice(md.indexOf('## Introduction'), md.indexOf('## Results'));
  const bullets = intro.split('\n').filter((line) => line.startsWith('- '));

  assert.equal(bullets.length, 3);
  assert.match(bullets[0], /312 adults/);
  assert.doesNotMatch(intro, /no change at all/);
});
