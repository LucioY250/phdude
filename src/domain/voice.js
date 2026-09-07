// Author voice profiles (PRD S30): descriptive statistics only, never opaque embeddings, so a
// researcher can inspect and correct what PhDude inferred. Pure - no I/O, no clock.
//
// Every sentence, word and rate here comes from `textstats`, the one text-analysis primitive in
// PhDude, so a profile learned from a sample and a draft measured against it are read the same
// way. The only word list this module owns is the stopword list `preserved_terms` filters on:
// terminology extraction is not a prose rule, so it does not live in the language tables.

import { findPhrases, stats, words } from './textstats.js';

const STOPWORDS = {
  en: new Set([
    'about',
    'across',
    'after',
    'again',
    'against',
    'always',
    'anything',
    'around',
    'because',
    'before',
    'being',
    'below',
    'between',
    'cannot',
    'during',
    'either',
    'everything',
    'further',
    'having',
    'however',
    'inside',
    'little',
    'moreover',
    'myself',
    'nothing',
    'others',
    'people',
    'shall',
    'should',
    'someone',
    'something',
    'their',
    'theirs',
    'themselves',
    'there',
    'therefore',
    'these',
    'those',
    'through',
    'toward',
    'towards',
    'under',
    'until',
    'upon',
    'usually',
    'where',
    'which',
    'while',
    'within',
    'without',
    'would',
    'yourself',
    'yourselves',
  ]),
  es: new Set([
    'además',
    'algunas',
    'algunos',
    'aquella',
    'aquellas',
    'aquello',
    'aquellos',
    'cualquier',
    'cuando',
    'debido',
    'dentro',
    'desde',
    'después',
    'donde',
    'durante',
    'entonces',
    'entre',
    'aunque',
    'hacia',
    'incluso',
    'mediante',
    'mientras',
    'misma',
    'mismas',
    'mismo',
    'mismos',
    'mucha',
    'muchas',
    'mucho',
    'muchos',
    'nosotras',
    'nosotros',
    'nuestra',
    'nuestras',
    'nuestro',
    'nuestros',
    'porque',
    'siempre',
    'sobre',
    'también',
    'tampoco',
    'todas',
    'todos',
    'aquel',
  ]),
};

const MIN_TERM_LENGTH = 6;
const PRESERVED_TERMS = 15;

function stopwordsFor(lang) {
  const code = String(lang ?? '')
    .toLowerCase()
    .split(/[-_]/)[0];
  return STOPWORDS[code] ?? new Set();
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// Top 15 non-stopword tokens at least 6 letters long, by frequency, ties broken alphabetically.
// Explicit and inspectable, never an embedding (PRD S30).
function preservedTerms(text, lang) {
  const stopwords = stopwordsFor(lang);
  const freq = new Map();
  for (const raw of words(text)) {
    const term = raw.toLowerCase();
    if (stopwords.has(term)) continue;
    if (!/\p{L}/u.test(term)) continue;
    if (term.replace(/['’-]/g, '').length < MIN_TERM_LENGTH) continue;
    freq.set(term, (freq.get(term) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, PRESERVED_TERMS)
    .map(([term]) => term);
}

// A language with no prose table has no transition, first-person or hedge rate at all
// (`textstats` reports null rather than a misleading zero). The profile schema wants a number,
// so an unmeasurable rate is recorded as 0 - and `gate-voice` never compares it, because the
// draft's own rate is null for the same language and the comparison is skipped.
function rateOf(value) {
  return typeof value === 'number' ? value : 0;
}

/**
 * Pure. Learns descriptive statistics from one or more researcher-approved writing samples,
 * concatenated into a single corpus so sentence/paragraph statistics reflect the whole body of
 * work rather than an average of averages. Deterministic: the same texts always produce the
 * same numbers. Does not set `learned_at` - that is a timestamp, and this function has no
 * clock; the caller stamps it.
 * @param {string|string[]} texts
 * @param {string} [lang]
 * @returns {{sentence_length_mean: number, sentence_length_sd: number, opening_diversity: number,
 *   transition_rate: number, first_person_rate: number, hedge_rate: number,
 *   paragraph_density: number, preserved_terms: string[], sample_count: number}}
 */
export function learnFrom(texts, lang) {
  const list = (Array.isArray(texts) ? texts : [texts]).filter(
    (t) => typeof t === 'string' && t.trim() !== '',
  );
  const corpus = list.join('\n\n');
  const measured = stats(corpus, lang);
  return {
    sentence_length_mean: measured.meanLen,
    sentence_length_sd: measured.sdLen,
    opening_diversity: measured.openingDiversity,
    transition_rate: rateOf(measured.transitionRate),
    first_person_rate: rateOf(measured.firstPersonRate),
    hedge_rate: rateOf(measured.hedgeRate),
    paragraph_density: measured.paragraphDensity,
    preserved_terms: preservedTerms(corpus, lang),
    sample_count: list.length,
  };
}

const LEARNED_NUMERIC_FIELDS = [
  'sentence_length_mean',
  'sentence_length_sd',
  'opening_diversity',
  'transition_rate',
  'first_person_rate',
  'hedge_rate',
  'paragraph_density',
  'sample_count',
];

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// The most frequent value across `profiles`, ties broken by whichever profile appears first:
// scanning values in profile order and returning the first one whose frequency equals the max
// does exactly that, tie or no tie.
function mode(profiles, getter) {
  const values = profiles.map(getter);
  const freq = new Map();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  const maxFreq = Math.max(...freq.values());
  return values.find((v) => freq.get(v) === maxFreq);
}

function unionSorted(lists) {
  return [...new Set(lists.flat())].sort();
}

function intersection(lists) {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists.map((l) => new Set(l));
  return [...first].filter((item) => rest.every((s) => s.has(item))).sort();
}

/**
 * Pure. Merges participating author profiles into `project-consensus` (PRD S30.2): categorical
 * fields by mode (ties keep the first profile's value), `terminology.preserve` by union,
 * `terminology.avoid` by intersection, and every numeric `learned` field by median. Only
 * profiles that have run `learn` contribute to `learned`; if none have, the merged profile
 * carries none either. Does not set `learned.learned_at` - the caller stamps that.
 * @param {object[]} profiles - non-empty; each a `phdude.author-profile`
 * @returns {object} a `phdude.author-profile`-shaped object with `id: 'project-consensus'`
 */
export function consensus(profiles) {
  const learnedProfiles = profiles.filter((p) => p.learned);

  const merged = {
    schema: 'phdude.author-profile',
    version: 1,
    id: 'project-consensus',
    language: mode(profiles, (p) => p.language),
    tone: {
      academic: mode(profiles, (p) => p.tone.academic),
      assertiveness: mode(profiles, (p) => p.tone.assertiveness),
      first_person: mode(profiles, (p) => p.tone.first_person),
    },
    sentences: {
      length: mode(profiles, (p) => p.sentences.length),
      openings: mode(profiles, (p) => p.sentences.openings),
    },
    paragraphs: {
      density: mode(profiles, (p) => p.paragraphs.density),
    },
    transitions: mode(profiles, (p) => p.transitions),
    terminology: {
      preserve: unionSorted(profiles.map((p) => p.terminology?.preserve ?? [])),
      avoid: intersection(profiles.map((p) => p.terminology?.avoid ?? [])),
    },
    samples: [],
  };

  if (learnedProfiles.length > 0) {
    const learned = {};
    for (const field of LEARNED_NUMERIC_FIELDS) {
      learned[field] = round3(median(learnedProfiles.map((p) => p.learned[field])));
    }
    learned.preserved_terms = unionSorted(learnedProfiles.map((p) => p.learned.preserved_terms));
    merged.learned = learned;
  }

  return merged;
}

/**
 * The tolerance each compared metric is allowed to drift by. Sentence length and its spread are
 * relative (a fraction of the profile's own value, because a mean of 30 words tolerates more
 * absolute drift than a mean of 12); the three rates are absolute, because they are already
 * fractions of 1.
 */
export const DEFAULT_TOLERANCES = {
  sentence_length: 0.25,
  sentence_length_sd: 0.5,
  opening_diversity: 0.15,
  transition_rate: 0.1,
  first_person_rate: 0.1,
};

// The five metrics spec S3.4 gate 4 names, each mapping a `textstats.stats` field onto the
// `learned` field it is compared against.
const METRICS = [
  {
    kind: 'sentence-length',
    label: 'mean sentence length',
    stat: 'meanLen',
    learned: 'sentence_length_mean',
    tolerance: 'sentence_length',
    relative: true,
  },
  {
    kind: 'sentence-length-sd',
    label: 'sentence length spread',
    stat: 'sdLen',
    learned: 'sentence_length_sd',
    tolerance: 'sentence_length_sd',
    relative: true,
  },
  {
    kind: 'opening-diversity',
    label: 'opening diversity',
    stat: 'openingDiversity',
    learned: 'opening_diversity',
    tolerance: 'opening_diversity',
    relative: false,
  },
  {
    kind: 'transition-rate',
    label: 'transition rate',
    stat: 'transitionRate',
    learned: 'transition_rate',
    tolerance: 'transition_rate',
    relative: false,
  },
  {
    kind: 'first-person-rate',
    label: 'first-person rate',
    stat: 'firstPersonRate',
    learned: 'first_person_rate',
    tolerance: 'first_person_rate',
    relative: false,
  },
];

// Every metric both sides can supply, with the tolerance band expressed in the metric's own
// units so a finding can name it. A metric whose band works out to zero - a relative tolerance
// on a learned value of 0 - is not comparable and is skipped rather than always deviating.
function comparisons(measured, learned, tolerances) {
  const rows = [];
  for (const metric of METRICS) {
    const actual = measured?.[metric.stat];
    const expected = learned?.[metric.learned];
    if (typeof actual !== 'number' || typeof expected !== 'number') continue;
    const allowed = tolerances?.[metric.tolerance] ?? DEFAULT_TOLERANCES[metric.tolerance];
    if (typeof allowed !== 'number') continue;
    const band = metric.relative ? round3(Math.abs(expected) * allowed) : allowed;
    if (!(band > 0)) continue;
    const deviation = round3(Math.abs(actual - expected));
    rows.push({ ...metric, actual, expected, band, deviation, ratio: round3(deviation / band) });
  }
  return rows;
}

function avoidedWords(text, profile) {
  const avoid = profile?.terminology?.avoid ?? [];
  if (avoid.length === 0 || typeof text !== 'string' || text === '') return [];
  const byLower = new Map(avoid.map((word) => [String(word).toLowerCase(), word]));
  const found = new Map();
  for (const hit of findPhrases(text, [...byLower.keys()])) {
    if (!found.has(hit.phrase)) found.set(hit.phrase, hit.index);
  }
  return [...found.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([phrase, index]) => {
      const word = byLower.get(phrase);
      return {
        kind: 'avoid-word',
        why: `uses "${word}", which the profile's terminology.avoid lists`,
        word,
        index,
      };
    });
}

/**
 * Pure. Compares a draft's descriptive statistics against the active voice profile's `learned`
 * baseline and reports deviations beyond `tolerances`, plus any use of a word listed in
 * `terminology.avoid` - never a silent rewrite (PRD S30.2). `deviation` is always the absolute
 * difference in the metric's own units and `tolerance` is the band it was judged against, so a
 * caller can print "31.2 vs learned 18.4 ± 4.6" without knowing which metrics are relative.
 * @param {object} stats - a `textstats.stats` result, carrying additionally the `text` it was
 *   measured over (the terminology check reads words, not numbers)
 * @param {object} profile - a `phdude.author-profile`; only `terminology.avoid` is read when it
 *   has no `learned` block
 * @param {object} [tolerances] - defaults to `DEFAULT_TOLERANCES`
 * @returns {object[]} findings, deviations first in metric order, then avoided words in the
 *   order they appear in the text
 */
export function voiceDeviation(stats, profile, tolerances = DEFAULT_TOLERANCES) {
  const outside = comparisons(stats, profile?.learned, tolerances)
    .filter((row) => row.ratio > 1)
    .map((row) => ({
      kind: row.kind,
      why: `${row.label} ${row.actual} vs learned ${row.expected} ± ${row.band}`,
      expected: row.expected,
      actual: row.actual,
      deviation: row.deviation,
      tolerance: row.band,
    }));

  return [...outside, ...avoidedWords(stats?.text, profile)];
}

/**
 * Pure. How closely a draft matches the profile it was written under, 0-100: 100 minus 25 times
 * the mean deviation of the compared metrics, each deviation measured in multiples of its own
 * tolerance. A draft sitting exactly on every tolerance scores 75; one four times outside every
 * tolerance scores 0.
 * @param {object} stats - a `textstats.stats` result
 * @param {object} profile - a `phdude.author-profile`
 * @param {object} [tolerances]
 * @returns {number|null} null when nothing is comparable (no profile, or none learned yet)
 */
export function voiceScore(stats, profile, tolerances = DEFAULT_TOLERANCES) {
  const rows = comparisons(stats, profile?.learned, tolerances);
  if (rows.length === 0) return null;
  const mean = rows.reduce((sum, row) => sum + row.ratio, 0) / rows.length;
  return Math.max(0, Math.min(100, Math.round(100 - 25 * mean)));
}
