import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assemble,
  assetReferences,
  buildDate,
  buildFormat,
  buildPaths,
  buildRecord,
  buildSlug,
  extensionFor,
  planBuild,
  profileHash,
  selectSections,
} from '../../../src/domain/build.js';
import { sectionHash } from '../../../src/domain/manuscript.js';
import { PhdudeError } from '../../../src/domain/errors.js';

const PROFILE = {
  schema: 'phdude.profile',
  version: 1,
  name: 'ieee',
  display: 'IEEE conference paper',
  document_class: 'IEEEtran',
  citation_style: 'csl/ieee.csl',
  sections: [
    { id: 'abstract', title: 'Abstract', required: true, order: 1 },
    { id: 'introduction', title: 'Introduction', required: true, order: 2 },
    { id: 'methods', title: 'Method', required: true, order: 3 },
    { id: 'conclusions', title: 'Conclusion', required: true, order: 4 },
  ],
  abstract: { max_words: 250 },
  figures: { formats: ['pdf', 'png'] },
  references: { style: 'IEEE' },
};

function manuscriptWith(statuses) {
  return {
    schema: 'phdude.manuscript',
    version: 1,
    title: 'Edge Scheduling Under Load',
    language: 'en',
    voice: { kind: 'consensus' },
    sections: Object.entries(statuses).map(([id, status], index) => ({
      id,
      title: id[0].toUpperCase() + id.slice(1),
      file: `manuscript/${id}.md`,
      order: index + 1,
      status,
      hash: null,
      claims: [],
      questions: [],
    })),
  };
}

function throwsWith(fn, code, match) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof PhdudeError, `expected PhdudeError, got ${err}`);
    assert.equal(err.code, code, err.message);
    if (match) assert.match(`${err.message} ${err.hint ?? ''}`, match);
    return true;
  });
}

test('buildFormat defaults to md and refuses a format no renderer names', () => {
  assert.equal(buildFormat(undefined), 'md');
  assert.equal(buildFormat(''), 'md');
  assert.equal(buildFormat('latex'), 'latex');
  throwsWith(() => buildFormat('epub'), 'VALIDATION', /formats are md, docx, html, latex, pdf/);
});

test('extensionFor maps latex to .tex and leaves the others alone', () => {
  assert.equal(extensionFor('latex'), 'tex');
  assert.equal(extensionFor('md'), 'md');
  assert.equal(extensionFor('docx'), 'docx');
  assert.equal(extensionFor('pdf'), 'pdf');
  assert.equal(extensionFor('html'), 'html');
});

test('buildSlug names the directory after the manuscript, and falls back when it cannot', () => {
  assert.equal(buildSlug({ title: 'Edge Scheduling Under Load' }), 'edge-scheduling-under-load');
  assert.equal(buildSlug({ title: '  ***  ' }), 'manuscript');
  assert.equal(buildSlug(null), 'manuscript');
});

test('buildPaths puts deliverables under outputs/ and the assembled source in the cache', () => {
  const paths = buildPaths('thesis', 'latex');
  assert.equal(paths.dir, 'outputs/thesis');
  assert.equal(paths.document, 'outputs/thesis/manuscript.tex');
  assert.equal(paths.bib, 'outputs/thesis/references.bib');
  assert.equal(paths.figures, 'outputs/thesis/figures');
  assert.equal(paths.source, '.phdude/cache/build/thesis/latex.md');
  assert.equal(paths.record, '.phdude/cache/build/thesis/latex.json');
});

test('the md build writes its source to the cache, never over its own output', () => {
  const paths = buildPaths('thesis', 'md');
  assert.equal(paths.document, 'outputs/thesis/manuscript.md');
  assert.notEqual(paths.source, paths.document);
});

test('selectSections takes approved prose only, in the venue order', () => {
  const manuscript = manuscriptWith({
    abstract: 'approved',
    introduction: 'approved',
    methods: 'draft',
    conclusions: 'approved',
  });
  const chosen = selectSections(manuscript, PROFILE);
  assert.deepEqual(
    chosen.map((section) => section.id),
    ['abstract', 'introduction', 'conclusions'],
  );
  assert.deepEqual(
    chosen.map((section) => section.title),
    ['Abstract', 'Introduction', 'Conclusion'],
  );
});

test('selectSections takes drafts and revisions only when asked', () => {
  const manuscript = manuscriptWith({
    introduction: 'approved',
    methods: 'draft',
    conclusions: 'revised',
    results: 'planned',
  });
  assert.deepEqual(
    selectSections(manuscript, PROFILE, { includeDrafts: true }).map((s) => s.id),
    ['introduction', 'methods', 'conclusions'],
  );
});

test('selectSections puts a section the venue never heard of after the ones it names', () => {
  const manuscript = manuscriptWith({
    appendix: 'approved',
    introduction: 'approved',
    conclusions: 'approved',
  });
  assert.deepEqual(
    selectSections(manuscript, PROFILE).map((s) => s.id),
    ['introduction', 'conclusions', 'appendix'],
  );
});

test('selectSections keeps manuscript order when there is no profile', () => {
  const manuscript = manuscriptWith({ conclusions: 'approved', introduction: 'approved' });
  assert.deepEqual(
    selectSections(manuscript, null).map((s) => s.id),
    ['conclusions', 'introduction'],
  );
});

test('--sections narrows the build, and names a section the manuscript does not have', () => {
  const manuscript = manuscriptWith({ introduction: 'approved', conclusions: 'approved' });
  assert.deepEqual(
    selectSections(manuscript, PROFILE, { only: ['conclusions'] }).map((s) => s.id),
    ['conclusions'],
  );
  throwsWith(
    () => selectSections(manuscript, PROFILE, { only: ['appendix'] }),
    'VALIDATION',
    /no section "appendix".*introduction, conclusions/s,
  );
});

test('a section asked for by name that is not approved is refused, not quietly dropped', () => {
  const manuscript = manuscriptWith({ introduction: 'approved', methods: 'draft' });
  throwsWith(
    () => selectSections(manuscript, PROFILE, { only: ['methods'] }),
    'VALIDATION',
    /methods is draft.*--include-drafts/s,
  );
  throwsWith(
    () => selectSections(manuscriptWith({ results: 'planned' }), PROFILE, { only: ['results'] }),
    'VALIDATION',
    /phdude write results/,
  );
});

test('buildDate prefers the manuscript date, then the last approval, then nothing', () => {
  assert.equal(
    buildDate({ date: '2026-05-04T10:00:00.000Z' }, '2026-09-01T00:00:00.000Z'),
    '2026-05-04',
  );
  assert.equal(buildDate({}, '2026-09-01T00:01:14.000Z'), '2026-09-01');
  assert.equal(buildDate({}, null), null);
  assert.equal(buildDate(null, 'not a date'), null);
});

test('assetReferences finds the figures the prose shows and the tables it includes', () => {
  const markdown = [
    'Adoption rose ![Adoption by channel](figures/out/adoption.svg) across channels.',
    '',
    '[Table 1](tables/out/mean-weight.md)',
    '',
    'See [the raw file](tables/out/mean-weight.csv) for the numbers, or [the site](https://x.test).',
    '',
    '![again](figures/out/adoption.svg)',
    '',
    '![elsewhere](assets/logo.png)',
  ].join('\n');

  assert.deepEqual(assetReferences(markdown), {
    figures: ['figures/out/adoption.svg'],
    tables: ['tables/out/mean-weight.md'],
  });
});

test('assetReferences never reaches outside figures/out or tables/out', () => {
  const markdown = [
    '![escape](figures/out/../../../etc/passwd)',
    '![dot](figures/out/./x.svg)',
    '![empty](figures/out//x.svg)',
    '![bare](figures/out/)',
    '',
    '[t](tables/out/../../secret.txt)',
    '',
    '[ok](tables/out/mean-weight.md)',
    '![ok](figures/out/adoption.svg)',
  ].join('\n');
  assert.deepEqual(assetReferences(markdown), {
    figures: ['figures/out/adoption.svg'],
    tables: ['tables/out/mean-weight.md'],
  });
});

test('a table link inside a sentence is a reference, not an include', () => {
  const markdown = 'The numbers are in [Table 1](tables/out/mean-weight.md), which is unchanged.';
  assert.deepEqual(assetReferences(markdown).tables, []);
});

test('assemble writes one heading per section under the venue title, abstract excepted', () => {
  const manuscript = manuscriptWith({ abstract: 'approved', introduction: 'approved' });
  const sections = [
    { id: 'abstract', title: 'Abstract', file: 'manuscript/abstract.md', body: 'One paragraph.' },
    {
      id: 'introduction',
      title: 'Introduction',
      file: 'manuscript/introduction.md',
      body: 'The problem is scheduling.',
    },
  ];

  const { markdown, metadata } = assemble(
    { project: { title: 'Project' }, authors: [{ name: 'Ada Lovelace' }] },
    manuscript,
    sections,
    PROFILE,
  );

  assert.equal(markdown, '# Introduction\n\nThe problem is scheduling.\n');
  assert.equal(metadata.abstract, 'One paragraph.');
  assert.equal(metadata.title, 'Edge Scheduling Under Load');
  assert.deepEqual(metadata.author, ['Ada Lovelace']);
  assert.equal(metadata.draft, undefined);
});

test('assemble reports the section files it read, hashed the way the manuscript hashes them', () => {
  const manuscript = manuscriptWith({ introduction: 'approved' });
  const { inputs } = assemble(
    { project: null, authors: [] },
    manuscript,
    [
      {
        id: 'introduction',
        title: 'Introduction',
        file: 'manuscript/introduction.md',
        body: 'Prose.\n',
      },
    ],
    PROFILE,
  );
  assert.deepEqual(inputs, { 'manuscript/introduction.md': sectionHash('Prose.\n') });
});

test('assemble says on the front page when the document carries unapproved prose', () => {
  const manuscript = manuscriptWith({ introduction: 'draft' });
  const { metadata } = assemble(
    { project: null, authors: [] },
    manuscript,
    [{ id: 'introduction', title: 'Introduction', file: 'manuscript/introduction.md', body: 'x' }],
    PROFILE,
    { includeDrafts: true },
  );
  assert.equal(metadata.draft, true);
});

test('assemble rewrites figure links to where the build copied them, and inlines tables', () => {
  const manuscript = manuscriptWith({ results: 'approved' });
  const body = [
    '![Adoption by channel](figures/out/adoption.svg)',
    '',
    '[Table 1](tables/out/mean-weight.md)',
    '',
    'Nothing else moved.',
  ].join('\n');

  const { markdown } = assemble(
    { project: null, authors: [] },
    manuscript,
    [{ id: 'results', title: 'Results', file: 'manuscript/results.md', body }],
    PROFILE,
    {
      figures: new Map([['figures/out/adoption.svg', 'figures/adoption.pdf']]),
      tables: new Map([['tables/out/mean-weight.md', '| a |\n| --- |\n| 1 |\n\nTable: Means.\n']]),
    },
  );

  assert.match(markdown, /!\[Adoption by channel\]\(figures\/adoption\.pdf\)/);
  assert.doesNotMatch(markdown, /figures\/out/);
  assert.match(markdown, /^Table: Means\.$/m);
  assert.doesNotMatch(markdown, /tables\/out/);
  assert.match(markdown, /Nothing else moved\./);
});

test('assemble leaves an asset the build could not resolve exactly as the prose wrote it', () => {
  const manuscript = manuscriptWith({ results: 'approved' });
  const body = '![Missing](figures/out/gone.svg)\n';
  const { markdown } = assemble(
    { project: null, authors: [] },
    manuscript,
    [{ id: 'results', title: 'Results', file: 'manuscript/results.md', body }],
    PROFILE,
  );
  assert.match(markdown, /!\[Missing\]\(figures\/out\/gone\.svg\)/);
});

test('assemble is deterministic: the same inputs make the same bytes', () => {
  const manuscript = manuscriptWith({ introduction: 'approved' });
  const args = [
    { project: null, authors: [{ name: 'B' }, { name: 'A' }], approvedAt: '2026-01-01T00:00:00Z' },
    manuscript,
    [{ id: 'introduction', title: 'Introduction', file: 'manuscript/introduction.md', body: 'x' }],
    PROFILE,
  ];
  const first = assemble(...args);
  const second = assemble(...args);
  assert.equal(first.markdown, second.markdown);
  assert.deepEqual(first.metadata, second.metadata);
  assert.deepEqual(first.metadata.author, ['B', 'A']);
});

test('profileHash ignores where PhDude is installed', () => {
  const here = { ...PROFILE, dir: '/opt/phdude/packs/venues/ieee', cslPath: '/opt/x.csl' };
  const there = { ...PROFILE, dir: '/home/r/.phdude/packs/venues/ieee', cslPath: '/home/r/x.csl' };
  assert.equal(profileHash(here), profileHash(there));
  assert.notEqual(profileHash(here), profileHash({ ...PROFILE, document_class: 'acmart' }));
  assert.equal(typeof profileHash(null), 'string');
});

const INPUTS = { 'manuscript/introduction.md': 'a'.repeat(64), renderer: 'markdown 1' };
const RECORD = buildRecord({
  format: 'md',
  profile: 'ieee',
  renderer: 'markdown',
  rendererVersion: 'markdown phdude 0.6.0',
  at: '2026-09-08T00:00:00.000Z',
  inputs: INPUTS,
  output: { path: 'outputs/x/manuscript.md', hash: 'b'.repeat(64) },
});
const ON_DISK = { path: 'outputs/x/manuscript.md', hash: 'b'.repeat(64) };

test('planBuild reports a build with nothing moved as up to date', () => {
  assert.deepEqual(planBuild(RECORD, INPUTS, 'markdown phdude 0.6.0', ON_DISK), {
    upToDate: true,
    changed: [],
  });
});

test('planBuild names what moved: a section, an input added, an input gone', () => {
  assert.deepEqual(
    planBuild(
      RECORD,
      { ...INPUTS, 'manuscript/introduction.md': 'c'.repeat(64) },
      'markdown phdude 0.6.0',
      ON_DISK,
    ).changed,
    ['manuscript/introduction.md'],
  );
  assert.deepEqual(
    planBuild(RECORD, { ...INPUTS, 'figures/out/x.svg': 'd' }, 'markdown phdude 0.6.0', ON_DISK)
      .changed,
    ['figures/out/x.svg'],
  );
  const withoutRenderer = { 'manuscript/introduction.md': INPUTS['manuscript/introduction.md'] };
  assert.deepEqual(planBuild(RECORD, withoutRenderer, 'markdown phdude 0.6.0', ON_DISK).changed, [
    'renderer',
  ]);
});

test('planBuild rebuilds after a renderer upgrade, because the bytes may differ', () => {
  const plan = planBuild(RECORD, INPUTS, 'markdown phdude 0.7.0', ON_DISK);
  assert.equal(plan.upToDate, false);
  assert.deepEqual(plan.changed, ['renderer']);
});

test('planBuild rebuilds when the file it claims to have written is gone or is something else', () => {
  assert.deepEqual(
    planBuild(RECORD, INPUTS, 'markdown phdude 0.6.0', { ...ON_DISK, hash: null }).changed,
    ['output'],
  );
  assert.deepEqual(
    planBuild(RECORD, INPUTS, 'markdown phdude 0.6.0', { ...ON_DISK, hash: 'e'.repeat(64) })
      .changed,
    ['output'],
  );
});

test('planBuild treats no record at all as everything having moved', () => {
  assert.deepEqual(planBuild(null, INPUTS, 'markdown phdude 0.6.0', ON_DISK), {
    upToDate: false,
    changed: ['*'],
  });
});
