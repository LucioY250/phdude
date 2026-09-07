import test from 'node:test';
import assert from 'node:assert/strict';
import { bibkeyFor, assignBibkeys } from '../../../src/domain/bibkey.js';

test('bibkeyFor: surname + year + first title word, lowercased ASCII', () => {
  assert.equal(
    bibkeyFor({ authors: ['Ada Lovelace'], year: 2020, title: 'A Survey of Machines' }),
    'lovelace2020survey',
  );
});

test('bibkeyFor: strips diacritics from the surname via NFKD', () => {
  assert.equal(
    bibkeyFor({ authors: ['José García'], year: 2021, title: 'Adoption Patterns' }),
    'garcia2021adoption',
  );
});

test('bibkeyFor: strips diacritics from the title word too', () => {
  assert.equal(
    bibkeyFor({ authors: ['A. One'], year: 2019, title: 'Étude Longitudinal' }),
    'one2019etude',
  );
});

test('bibkeyFor: skips stopwords and short words when picking the first title word', () => {
  assert.equal(
    bibkeyFor({ authors: ['A. One'], year: 2019, title: 'The Rise of AI in Education' }),
    'one2019rise',
  );
});

test('bibkeyFor: a stopword that is also long enough (e.g. "with") is still skipped', () => {
  assert.equal(
    bibkeyFor({ authors: ['A. One'], year: 2019, title: 'On With The Regression Study' }),
    'one2019regression',
  );
});

test('bibkeyFor: no author -> "anon"', () => {
  assert.equal(bibkeyFor({ authors: [], year: 2020, title: 'A Survey' }), 'anon2020survey');
});

test('bibkeyFor: no year -> "nd"', () => {
  assert.equal(bibkeyFor({ authors: ['A. One'], title: 'A Survey of Machines' }), 'onendsurvey');
});

test('bibkeyFor: no usable title word -> "untitled"', () => {
  assert.equal(bibkeyFor({ authors: ['A. One'], year: 2020, title: 'On To' }), 'one2020untitled');
  assert.equal(bibkeyFor({ authors: ['A. One'], year: 2020, title: '' }), 'one2020untitled');
});

test('bibkeyFor: only the last token of the first author counts as the surname', () => {
  assert.equal(
    bibkeyFor({ authors: ['Maria de la Cruz'], year: 2020, title: 'Field Study' }),
    'cruz2020field',
  );
});

test('bibkeyFor: a comma-form "Family, Given" author takes everything before the comma as the surname', () => {
  assert.equal(
    bibkeyFor({ authors: ['de la Cruz, Maria'], year: 2020, title: 'Field Study' }),
    'delacruz2020field',
  );
});

test('bibkeyFor: a comma-form single-word family name works the same as natural order', () => {
  assert.equal(
    bibkeyFor({ authors: ['Lovelace, Ada'], year: 2020, title: 'A Survey of Machines' }),
    'lovelace2020survey',
  );
});

test('assignBibkeys: derives a key per source, stable order by id', () => {
  const sources = [
    { id: 'SRC-b', authors: ['B. Two'], year: 2020, title: 'Second Study' },
    { id: 'SRC-a', authors: ['A. One'], year: 2020, title: 'First Study' },
  ];
  const keys = assignBibkeys(sources);
  assert.equal(keys.get('SRC-a'), 'one2020first');
  assert.equal(keys.get('SRC-b'), 'two2020second');
});

test('assignBibkeys: collisions get -2, -3... in id order', () => {
  const sources = [
    { id: 'SRC-a', authors: ['A. One'], year: 2020, title: 'Survey Alpha' },
    { id: 'SRC-b', authors: ['A. One'], year: 2020, title: 'Survey Beta' },
    { id: 'SRC-c', authors: ['A. One'], year: 2020, title: 'Survey Gamma' },
  ];
  const keys = assignBibkeys(sources);
  assert.equal(keys.get('SRC-a'), 'one2020survey');
  assert.equal(keys.get('SRC-b'), 'one2020survey-2');
  assert.equal(keys.get('SRC-c'), 'one2020survey-3');
});

test('assignBibkeys: an explicit bibkey is honored and wins over a derived key', () => {
  const sources = [
    { id: 'SRC-a', authors: ['A. One'], year: 2020, title: 'Survey Alpha' },
    { id: 'SRC-b', authors: ['A. One'], year: 2020, title: 'Survey Beta', bibkey: 'one2020survey' },
  ];
  const keys = assignBibkeys(sources);
  // SRC-b's explicit key is used as-is; SRC-a's derived key backs off since it collides.
  assert.equal(keys.get('SRC-b'), 'one2020survey');
  assert.equal(keys.get('SRC-a'), 'one2020survey-2');
});

test('assignBibkeys: two explicit bibkeys may collide - left as-is, not suffixed', () => {
  const sources = [
    { id: 'SRC-a', authors: ['A. One'], year: 2020, title: 'Survey Alpha', bibkey: 'dup' },
    { id: 'SRC-b', authors: ['B. Two'], year: 2021, title: 'Survey Beta', bibkey: 'dup' },
  ];
  const keys = assignBibkeys(sources);
  assert.equal(keys.get('SRC-a'), 'dup');
  assert.equal(keys.get('SRC-b'), 'dup');
});

test('assignBibkeys: is pure - does not mutate its input', () => {
  const sources = [{ id: 'SRC-a', authors: ['A. One'], year: 2020, title: 'Survey Alpha' }];
  const before = JSON.stringify(sources);
  assignBibkeys(sources);
  assert.equal(JSON.stringify(sources), before);
});
