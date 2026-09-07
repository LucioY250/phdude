// Author voice profiles (PRD S30): descriptive statistics only, never opaque embeddings, so a
// researcher can inspect and correct what PhDude inferred. Pure - no I/O, no clock.

// TODO(v0.4-T4): replace basicStats with textstats.stats(text, lang); this module's own
// sentence/word handling is a stand-in until that lands.
const WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

const LEXICONS = {
  en: {
    transitions: new Set([
      'however',
      'therefore',
      'moreover',
      'furthermore',
      'additionally',
      'consequently',
      'nevertheless',
      'nonetheless',
      'thus',
      'hence',
      'meanwhile',
      'accordingly',
    ]),
    firstPerson: new Set([
      'i',
      "i'm",
      "i've",
      "i'll",
      "i'd",
      'me',
      'my',
      'mine',
      'myself',
      'we',
      "we're",
      "we've",
      "we'll",
      "we'd",
      'us',
      'our',
      'ours',
      'ourselves',
    ]),
    hedges: new Set([
      'may',
      'might',
      'could',
      'possibly',
      'perhaps',
      'likely',
      'somewhat',
      'arguably',
      'seems',
      'appears',
      'suggests',
      'tends',
      'relatively',
    ]),
    stopwords: new Set([
      'about',
      'after',
      'again',
      'against',
      'before',
      'being',
      'below',
      'between',
      'cannot',
      'during',
      'either',
      'further',
      'having',
      'inside',
      'little',
      'myself',
      'others',
      'people',
      'should',
      'shall',
      'their',
      'theirs',
      'themselves',
      'there',
      'these',
      'those',
      'through',
      'under',
      'until',
      'where',
      'which',
      'while',
      'would',
      'across',
      'around',
      'because',
      'without',
      'within',
      'toward',
      'towards',
      'upon',
      'yourself',
      'yourselves',
      'something',
      'someone',
      'anything',
      'everything',
      'nothing',
      'always',
      'usually',
      'however',
      'therefore',
      'moreover',
    ]),
  },
};

// Only `en` is defined for now (see the T4 TODO above); an unrecognised language falls back to
// it rather than reporting every rate as zero.
function lexiconFor(lang) {
  return LEXICONS[lang] ?? LEXICONS.en;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function words(text) {
  return text.match(WORD_RE) ?? [];
}

// Splits on a `.?!` run followed by whitespace (or end of string), which is what the researcher
// asked this stopgap to do; abbreviations like "e.g." will over-split, same as any naive
// sentence splitter.
function splitSentences(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return [];
  return flat
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitParagraphs(text) {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function mean(nums) {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stddev(nums, avg) {
  if (nums.length === 0) return 0;
  return Math.sqrt(mean(nums.map((n) => (n - avg) ** 2)));
}

/**
 * Pure. Descriptive statistics for one block of text, in the shape both `learnFrom` and
 * `voiceDeviation` use: explicit, human-readable numbers plus the raw tokens and normalized
 * text a caller needs for terminology checks. Never an opaque embedding (PRD S30).
 * @param {string} text
 * @param {string} [lang] - only `en` word lists exist today; anything else falls back to them
 * @returns {{sentence_length_mean: number, sentence_length_sd: number, opening_diversity: number,
 *   transition_rate: number, first_person_rate: number, hedge_rate: number,
 *   paragraph_density: number, tokens: string[], text: string}}
 */
export function basicStats(text, lang) {
  const lexicon = lexiconFor(lang);
  const source = String(text ?? '');
  const sentences = splitSentences(source);
  const paragraphs = splitParagraphs(source);
  const tokens = words(source).map((w) => w.toLowerCase());

  const sentenceLengths = sentences.map((s) => words(s).length);
  const openings = sentences.map((s) => words(s)[0]?.toLowerCase()).filter(Boolean);
  const sentencesWithTransition = sentences.filter((s) =>
    words(s).some((w) => lexicon.transitions.has(w.toLowerCase())),
  ).length;

  const sentenceLengthMean = mean(sentenceLengths);
  const firstPersonCount = tokens.filter((t) => lexicon.firstPerson.has(t)).length;
  const hedgeCount = tokens.filter((t) => lexicon.hedges.has(t)).length;

  return {
    sentence_length_mean: round3(sentenceLengthMean),
    sentence_length_sd: round3(stddev(sentenceLengths, sentenceLengthMean)),
    opening_diversity: round3(
      sentences.length === 0 ? 0 : new Set(openings).size / sentences.length,
    ),
    transition_rate: round3(
      sentences.length === 0 ? 0 : sentencesWithTransition / sentences.length,
    ),
    first_person_rate: round3(tokens.length === 0 ? 0 : firstPersonCount / tokens.length),
    hedge_rate: round3(tokens.length === 0 ? 0 : hedgeCount / tokens.length),
    paragraph_density: round3(
      paragraphs.length === 0 ? sentences.length : sentences.length / paragraphs.length,
    ),
    tokens,
    text: source.toLowerCase(),
  };
}

// Top 15 non-stopword tokens at least 6 letters long, by frequency, ties broken alphabetically.
// Explicit and inspectable, never an embedding (PRD S30).
function preservedTerms(tokens, lang) {
  const lexicon = lexiconFor(lang);
  const freq = new Map();
  for (const raw of tokens) {
    const t = raw.toLowerCase();
    if (lexicon.stopwords.has(t)) continue;
    if (t.replace(/'/g, '').length < 6) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([term]) => term);
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
  const stats = basicStats(list.join('\n\n'), lang);
  return {
    sentence_length_mean: stats.sentence_length_mean,
    sentence_length_sd: stats.sentence_length_sd,
    opening_diversity: stats.opening_diversity,
    transition_rate: stats.transition_rate,
    first_person_rate: stats.first_person_rate,
    hedge_rate: stats.hedge_rate,
    paragraph_density: stats.paragraph_density,
    preserved_terms: preservedTerms(stats.tokens, lang),
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

const DEFAULT_TOLERANCES = {
  sentence_length: 0.25,
  transition_rate: 0.1,
  first_person_rate: 0.1,
  opening_diversity: 0.15,
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pure. Compares a draft's descriptive statistics against the active voice profile's `learned`
 * baseline and reports deviations beyond `tolerances`, plus any use of a word listed in
 * `terminology.avoid` - never a silent rewrite (PRD S30.2). Sentence length is compared
 * relatively (a fraction of the profile's own mean); the rate fields are compared as absolute
 * differences, since they are already fractions.
 * @param {{sentence_length_mean?: number, transition_rate?: number, first_person_rate?: number,
 *   opening_diversity?: number, text?: string}} stats - from `basicStats` (or, later, textstats.stats)
 * @param {object} profile - a `phdude.author-profile`; findings are empty when it has no `learned`
 * @param {{sentence_length?: number, transition_rate?: number, first_person_rate?: number,
 *   opening_diversity?: number}} [tolerances]
 * @returns {{kind: string, why: string, expected: number, actual: number, deviation: number}[]
 *   | {kind: 'avoid-word', why: string, word: string}[]}
 */
export function voiceDeviation(stats, profile, tolerances = DEFAULT_TOLERANCES) {
  const findings = [];
  const learned = profile?.learned;

  if (learned) {
    if (
      typeof stats.sentence_length_mean === 'number' &&
      typeof learned.sentence_length_mean === 'number' &&
      learned.sentence_length_mean !== 0
    ) {
      const deviation = round3(
        Math.abs(stats.sentence_length_mean - learned.sentence_length_mean) /
          learned.sentence_length_mean,
      );
      if (deviation > tolerances.sentence_length) {
        findings.push({
          kind: 'sentence-length',
          why:
            `average sentence length ${stats.sentence_length_mean} deviates from the ` +
            `profile's ${learned.sentence_length_mean} by ${deviation * 100}%`,
          expected: learned.sentence_length_mean,
          actual: stats.sentence_length_mean,
          deviation,
        });
      }
    }

    for (const field of ['transition_rate', 'first_person_rate', 'opening_diversity']) {
      if (typeof stats[field] !== 'number' || typeof learned[field] !== 'number') continue;
      const deviation = round3(Math.abs(stats[field] - learned[field]));
      if (deviation > tolerances[field]) {
        findings.push({
          kind: field.replace(/_/g, '-'),
          why: `${field.replace(/_/g, ' ')} ${stats[field]} deviates from the profile's ${learned[field]} by ${deviation}`,
          expected: learned[field],
          actual: stats[field],
          deviation,
        });
      }
    }
  }

  const text = stats?.text ?? '';
  for (const word of profile?.terminology?.avoid ?? []) {
    const re = new RegExp(`\\b${escapeRegExp(word.toLowerCase())}\\b`);
    if (re.test(text)) {
      findings.push({
        kind: 'avoid-word',
        why: `uses "${word}", which the profile's terminology.avoid lists`,
        word,
      });
    }
  }

  return findings;
}
