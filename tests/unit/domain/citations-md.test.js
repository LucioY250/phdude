import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBibtex } from '../../../src/domain/bibtex.js';
import { referenceEntry, resolveCitations } from '../../../src/domain/citations-md.js';

const ENTRIES = parseBibtex(`
@article{lovelace2020survey,
  author = {Ada Lovelace and Charles Babbage},
  title = {{A Survey of Machines}},
  year = {2020},
  journal = {Journal of Computing},
  doi = {10.1234/jc.2020.01}
}

@article{babbage2021engines,
  author = {Charles Babbage},
  title = {{Difference Engines Revisited}},
  year = {2021},
  journal = {Annals of Mechanism}
}

@book{hopper1952compiler,
  author = {Hopper, Grace M. and Ada Lovelace and Charles Babbage},
  title = {{The Education of a Compiler}},
  year = {1952}
}
`);

test('resolveCitations: a single key becomes an author-year parenthetical', () => {
  const { markdown } = resolveCitations('As shown [@babbage2021engines].', ENTRIES);
  assert.match(markdown, /As shown \(Babbage, 2021\)\./);
});

test('resolveCitations: two authors are joined with "and", three or more become et al.', () => {
  const { markdown } = resolveCitations(
    'Two [@lovelace2020survey] and three [@hopper1952compiler].',
    ENTRIES,
  );
  assert.match(markdown, /\(Lovelace and Babbage, 2020\)/);
  assert.match(markdown, /\(Hopper et al\., 1952\)/);
});

test('resolveCitations: several keys in one group are separated by semicolons', () => {
  const { markdown } = resolveCitations(
    'Both [@babbage2021engines; @hopper1952compiler].',
    ENTRIES,
  );
  assert.match(markdown, /\(Babbage, 2021; Hopper et al\., 1952\)/);
});

test('resolveCitations: a suppressed author leaves the year alone', () => {
  const { markdown } = resolveCitations('Babbage said so [-@babbage2021engines].', ENTRIES);
  assert.match(markdown, /Babbage said so \(2021\)\./);
});

test('resolveCitations: a locator is kept after the year', () => {
  const { markdown } = resolveCitations('The table [@babbage2021engines, p. 3].', ENTRIES);
  assert.match(markdown, /\(Babbage, 2021, p\. 3\)/);
});

test('resolveCitations: a prefix inside the group is kept before the author', () => {
  const { markdown } = resolveCitations('Elsewhere [see @babbage2021engines].', ENTRIES);
  assert.match(markdown, /\(see Babbage, 2021\)/);
});

test('resolveCitations: an unresolved key is left as written and warned about', () => {
  const { markdown, warnings } = resolveCitations('Unknown [@nosuchkey].', ENTRIES);
  assert.match(markdown, /Unknown \(@nosuchkey\)\./);
  assert.deepEqual(warnings, ['[@nosuchkey] does not resolve to an entry in the bibliography']);
});

test('resolveCitations: one unresolved key does not silence the resolved one beside it', () => {
  const { markdown, warnings } = resolveCitations(
    'Mixed [@babbage2021engines; @nosuchkey].',
    ENTRIES,
  );
  assert.match(markdown, /\(Babbage, 2021; @nosuchkey\)/);
  assert.equal(warnings.length, 1);
});

test('resolveCitations: a bracket group with no citation is left untouched', () => {
  const text = 'A [link](https://example.org) and an [aside].';
  const { markdown, warnings } = resolveCitations(text, ENTRIES);
  assert.equal(markdown, text);
  assert.deepEqual(warnings, []);
});

test('resolveCitations: an email address outside brackets is not a citation', () => {
  const text = 'Write to ada@example.org for the data.';
  assert.equal(resolveCitations(text, ENTRIES).markdown, text);
});

test('resolveCitations: the reference list holds the cited entries only, in author-year order', () => {
  const { markdown, cited } = resolveCitations(
    'Later [@lovelace2020survey] and earlier [@hopper1952compiler].',
    ENTRIES,
  );
  assert.deepEqual(cited, ['hopper1952compiler', 'lovelace2020survey']);
  const [body, references] = markdown.split('## References\n\n');
  assert.doesNotMatch(body, /Difference Engines/);
  assert.match(
    references,
    /^Hopper, G\. M\., Lovelace, A\., & Babbage, C\. \(1952\)\. The Education of a Compiler\.\n/,
  );
  assert.match(references, /Lovelace, A\., & Babbage, C\. \(2020\)\. A Survey of Machines\./);
  assert.ok(
    references.indexOf('Hopper') < references.indexOf('Lovelace'),
    'entries sort by first-author surname',
  );
});

test('resolveCitations: text with no citations gets no References heading', () => {
  const { markdown, cited } = resolveCitations('Nothing is cited here.\n', ENTRIES);
  assert.equal(markdown, 'Nothing is cited here.\n');
  assert.deepEqual(cited, []);
});

test('resolveCitations: the same key cited twice appears once in the list', () => {
  const { markdown, cited } = resolveCitations(
    'Once [@babbage2021engines] and again [@babbage2021engines].',
    ENTRIES,
  );
  assert.deepEqual(cited, ['babbage2021engines']);
  assert.equal(markdown.match(/Difference Engines Revisited/g).length, 1);
});

test('resolveCitations: the same input always renders the same bytes', () => {
  const text = 'Both [@hopper1952compiler; @lovelace2020survey].';
  assert.equal(resolveCitations(text, ENTRIES).markdown, resolveCitations(text, ENTRIES).markdown);
});

test('referenceEntry: venue, DOI and URL are appended when the entry carries them', () => {
  const entry = ENTRIES.find((e) => e.key === 'lovelace2020survey');
  assert.equal(
    referenceEntry(entry),
    'Lovelace, A., & Babbage, C. (2020). A Survey of Machines. Journal of Computing. https://doi.org/10.1234/jc.2020.01',
  );
});

test('referenceEntry: an entry with no year is dated n.d.', () => {
  const [entry] = parseBibtex('@misc{x, title = {{Untitled Work}}, author = {Ada Lovelace}}');
  assert.equal(referenceEntry(entry), 'Lovelace, A. (n.d.). Untitled Work.');
});

test('referenceEntry: an entry with no author is attributed to Anon.', () => {
  const [entry] = parseBibtex('@misc{x, title = {{Untitled Work}}, year = {1999}}');
  assert.equal(referenceEntry(entry), 'Anon. (1999). Untitled Work.');
  assert.match(resolveCitations('See [@x].', [entry]).markdown, /\(Anon\., 1999\)/);
});
