import test from 'node:test';
import assert from 'node:assert/strict';
import { toBibtex, toCslJson } from '../../../src/domain/bibtex.js';

function keysFor(sources) {
  return new Map(sources.map((s) => [s.id, s.bibkey]));
}

test('toBibtex: article entry with journal, DOI, url, keywords', () => {
  const sources = [
    {
      id: 'SRC-a',
      bibkey: 'lovelace2020survey',
      title: 'A Survey of Machines',
      authors: ['Ada Lovelace', 'Charles Babbage'],
      year: 2020,
      venue: 'Journal of Computing',
      type: 'article',
      identifiers: { doi: '10.1234/jc.2020.01' },
      url: 'https://example.org/paper',
      keywords: ['computing', 'history'],
    },
  ];
  const bib = toBibtex(sources, keysFor(sources));
  assert.equal(
    bib,
    [
      '@article{lovelace2020survey,',
      '  author = {Ada Lovelace and Charles Babbage},',
      '  title = {{A Survey of Machines}},',
      '  year = {2020},',
      '  journal = {Journal of Computing},',
      '  doi = {10.1234/jc.2020.01},',
      '  url = {https://example.org/paper},',
      '  keywords = {computing, history}',
      '}',
      '',
    ].join('\n'),
  );
});

test('toBibtex: entries are sorted by bibkey regardless of input order', () => {
  const sources = [
    {
      id: 'SRC-z',
      bibkey: 'zeta2020z',
      title: 'Z',
      authors: ['A. Zeta'],
      year: 2020,
      type: 'other',
    },
    {
      id: 'SRC-a',
      bibkey: 'alpha2020a',
      title: 'A',
      authors: ['A. Alpha'],
      year: 2020,
      type: 'other',
    },
  ];
  const bib = toBibtex(sources, keysFor(sources));
  assert.ok(bib.indexOf('alpha2020a') < bib.indexOf('zeta2020z'));
});

test('toBibtex: type mapping (book, chapter, thesis, report, preprint, web, dataset, other)', () => {
  const base = { authors: ['A. One'], year: 2020, title: 'T' };
  const sources = [
    { id: 'SRC-1', bibkey: 'k1', ...base, type: 'book' },
    { id: 'SRC-2', bibkey: 'k2', ...base, type: 'chapter', venue: 'A Book' },
    { id: 'SRC-3', bibkey: 'k3', ...base, type: 'thesis' },
    { id: 'SRC-4', bibkey: 'k4', ...base, type: 'report' },
    { id: 'SRC-5', bibkey: 'k5', ...base, type: 'preprint', venue: 'arXiv' },
    { id: 'SRC-6', bibkey: 'k6', ...base, type: 'web', url: 'https://example.org' },
    { id: 'SRC-7', bibkey: 'k7', ...base, type: 'dataset' },
    { id: 'SRC-8', bibkey: 'k8', ...base, type: 'other' },
  ];
  const bib = toBibtex(sources, keysFor(sources));
  assert.match(bib, /@book\{k1,/);
  assert.match(bib, /@incollection\{k2,\n(?:.*\n)*?\s*booktitle = \{A Book\}/);
  assert.match(bib, /@phdthesis\{k3,/);
  assert.match(bib, /@techreport\{k4,/);
  assert.match(bib, /@misc\{k5,\n(?:.*\n)*?\s*howpublished = \{arXiv\}/);
  assert.match(bib, /@misc\{k6,\n(?:.*\n)*?\s*url = \{https:\/\/example\.org\}/);
  assert.match(bib, /@misc\{k7,/);
  assert.match(bib, /@misc\{k8,/);
});

test('toBibtex: escapes &, %, _, # but preserves braces already in a value', () => {
  const sources = [
    {
      id: 'SRC-a',
      bibkey: 'k',
      title: 'AT&T and {NASA}: 50% faster, a_b #1',
      authors: ['A. One'],
      year: 2020,
      type: 'other',
    },
  ];
  const bib = toBibtex(sources, keysFor(sources));
  assert.match(bib, /title = \{\{AT\\&T and \{NASA\}: 50\\% faster, a\\_b \\#1\}\}/);
});

test('toBibtex: omits fields the source does not carry', () => {
  const sources = [{ id: 'SRC-a', bibkey: 'k', title: 'T', authors: [], type: 'other' }];
  const bib = toBibtex(sources, keysFor(sources));
  assert.equal(bib, '@misc{k,\n  title = {{T}}\n}\n');
});

test('toCslJson: article maps to article-journal with split author names', () => {
  const sources = [
    {
      id: 'SRC-a',
      bibkey: 'lovelace2020survey',
      title: 'A Survey of Machines',
      authors: ['Ada Lovelace'],
      year: 2020,
      venue: 'Journal of Computing',
      type: 'article',
      identifiers: { doi: '10.1234/jc.2020.01' },
      keywords: ['computing'],
    },
  ];
  const csl = toCslJson(sources, keysFor(sources));
  assert.deepEqual(csl, [
    {
      id: 'lovelace2020survey',
      type: 'article-journal',
      title: 'A Survey of Machines',
      author: [{ given: 'Ada', family: 'Lovelace' }],
      issued: { 'date-parts': [[2020]] },
      DOI: '10.1234/jc.2020.01',
      'container-title': 'Journal of Computing',
      keyword: 'computing',
    },
  ]);
});

test('toCslJson: type mapping for the rest of the source types', () => {
  const base = { authors: [], year: 2020, title: 'T' };
  const sources = [
    { id: 'SRC-1', bibkey: 'k1', ...base, type: 'book' },
    { id: 'SRC-2', bibkey: 'k2', ...base, type: 'chapter' },
    { id: 'SRC-3', bibkey: 'k3', ...base, type: 'thesis' },
    { id: 'SRC-4', bibkey: 'k4', ...base, type: 'report' },
    { id: 'SRC-5', bibkey: 'k5', ...base, type: 'preprint' },
    { id: 'SRC-6', bibkey: 'k6', ...base, type: 'web' },
    { id: 'SRC-7', bibkey: 'k7', ...base, type: 'dataset' },
    { id: 'SRC-8', bibkey: 'k8', ...base, type: 'other' },
  ];
  const csl = toCslJson(sources, keysFor(sources));
  const typeOf = (id) => csl.find((e) => e.id === id).type;
  assert.equal(typeOf('k1'), 'book');
  assert.equal(typeOf('k2'), 'chapter');
  assert.equal(typeOf('k3'), 'thesis');
  assert.equal(typeOf('k4'), 'report');
  assert.equal(typeOf('k5'), 'article');
  assert.equal(typeOf('k6'), 'webpage');
  assert.equal(typeOf('k7'), 'dataset');
  assert.equal(typeOf('k8'), 'document');
});

test('toCslJson: a single-token author name gets family only', () => {
  const sources = [
    { id: 'SRC-a', bibkey: 'k', title: 'T', authors: ['Cher'], year: 2020, type: 'other' },
  ];
  const csl = toCslJson(sources, keysFor(sources));
  assert.deepEqual(csl[0].author, [{ family: 'Cher' }]);
});

test('toCslJson: a comma-form "Family, Given" author splits on the comma, not whitespace', () => {
  const sources = [
    {
      id: 'SRC-a',
      bibkey: 'k',
      title: 'T',
      authors: ['de la Cruz, Maria Elena'],
      year: 2020,
      type: 'other',
    },
  ];
  const csl = toCslJson(sources, keysFor(sources));
  assert.deepEqual(csl[0].author, [{ given: 'Maria Elena', family: 'de la Cruz' }]);
});

test('toCslJson: a comma-form author with no given name after the comma gets family only', () => {
  const sources = [
    { id: 'SRC-a', bibkey: 'k', title: 'T', authors: ['Cher,'], year: 2020, type: 'other' },
  ];
  const csl = toCslJson(sources, keysFor(sources));
  assert.deepEqual(csl[0].author, [{ family: 'Cher' }]);
});

test('toCslJson: natural-order "Given Family" authors are unaffected', () => {
  const sources = [
    {
      id: 'SRC-a',
      bibkey: 'k',
      title: 'T',
      authors: ['Maria Elena de la Cruz'],
      year: 2020,
      type: 'other',
    },
  ];
  const csl = toCslJson(sources, keysFor(sources));
  assert.deepEqual(csl[0].author, [{ given: 'Maria Elena de la', family: 'Cruz' }]);
});

test('toCslJson: omits issued when the source has no year', () => {
  const sources = [{ id: 'SRC-a', bibkey: 'k', title: 'T', authors: [], type: 'other' }];
  const csl = toCslJson(sources, keysFor(sources));
  assert.equal('issued' in csl[0], false);
});

test('toCslJson: entries are sorted by bibkey', () => {
  const sources = [
    { id: 'SRC-z', bibkey: 'zeta', title: 'Z', authors: [], year: 2020, type: 'other' },
    { id: 'SRC-a', bibkey: 'alpha', title: 'A', authors: [], year: 2020, type: 'other' },
  ];
  const csl = toCslJson(sources, keysFor(sources));
  assert.deepEqual(
    csl.map((e) => e.id),
    ['alpha', 'zeta'],
  );
});
