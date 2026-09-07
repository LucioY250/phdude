import { normalizeLang, tableFor } from './lang/index.js';
import {
  findPhrases,
  opening,
  paragraphs,
  sentenceSpans,
  startsWithTransition,
  stats,
  stripMarkup,
  words,
} from './textstats.js';

// The single source of truth for prose observations (spec §4). `gate-prose` calls it on a
// manuscript section, `phdude prose --file` calls it on any text, and the `academic-prose`
// skill's `scripts/prose-lint.mjs` reaches it through that command. Pure: text in, findings out.
//
// PhDude never computes, accepts or targets an AI-detector score (PRD §30c). Every rule here
// names a concrete academic-writing problem a researcher can read, open and dispute.

// A paragraph needs this many sentences before its transition share means anything; below it a
// single connective would read as 100% density.
const TRANSITION_MIN_SENTENCES = 3;
const TRANSITION_DENSITY = 0.4;
const MONOTONY_MIN_SENTENCES = 5;
const MONOTONY_SD = 3;
const REPEATED_OPENING_MIN = 3;
const LIST_RUN_MIN = 3;
const HEDGES_PER_SENTENCE_MIN = 3;
const EXCERPT_MAX = 90;

const CITATION = /\[@[^\]]+\]/;
const EVIDENCE_MARKER = /<!--\s*(?:fact|result)\s*:/i;
const LIST_ITEM = /^[ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]+(.*)$/;

export const RULES = [
  'banned-phrase',
  'empty-phrase',
  'excessive-hedging',
  'repeated-openings',
  'sentence-monotony',
  'symmetrical-lists',
  'transition-density',
  'unsupported-intensifier',
  'vague-literature',
];

// The rules that need no language table. Everything else is skipped for a language PhDude has
// no resources for, and the `unsupported-language` note says so.
export const STRUCTURAL_RULES = ['repeated-openings', 'sentence-monotony', 'symmetrical-lists'];

export const SCORES = [
  'specificity',
  'evidenceAlignment',
  'epistemicPrecision',
  'structuralVariation',
  'authorVoice',
  'conciseness',
];

// How much each sub-score contributes to the aggregate. A score that is null (its input was not
// supplied) drops out and the remaining weights are renormalised, so the aggregate always
// describes exactly what was measured.
const WEIGHTS = {
  specificity: 0.2,
  evidenceAlignment: 0.2,
  epistemicPrecision: 0.2,
  structuralVariation: 0.15,
  authorVoice: 0.15,
  conciseness: 0.1,
};

export const FORMULAS = {
  specificity:
    '100 - 15 x (vague-literature + banned-phrase + empty-phrase) per 100 words, clamped to 0-100',
  evidenceAlignment:
    'computed against the evidence graph by the writing pipeline (gate-evidence); null without manuscript markers',
  epistemicPrecision:
    'computed against claim states and the epistemic-verb table by the writing pipeline (gate-evidence); null without manuscript markers',
  structuralVariation:
    '100 x (0.4 x min(1, sdLen/6) + 0.4 x openingDiversity + 0.2 x (1 - min(1, transitionRate/0.4))); without a language table the transition term is dropped and the other two weigh 0.5 each',
  authorVoice:
    'computed against the active author voice profile by the writing pipeline (gate-voice); null without a profile',
  conciseness:
    '100 - 10 x (empty-phrase + intensifier occurrences) per 100 words - 3 x max(0, meanLen - 30), clamped to 0-100',
  aggregate: 'weighted mean of the non-null sub-scores, weights 0.20/0.20/0.20/0.15/0.15/0.10',
};

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function excerptOf(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > EXCERPT_MAX ? `${clean.slice(0, EXCERPT_MAX - 1)}…` : clean;
}

function lineAt(paragraph, offset) {
  let line = paragraph.line;
  for (let i = 0; i < offset && i < paragraph.text.length; i++) {
    if (paragraph.text[i] === '\n') line++;
  }
  return line;
}

function spanAt(spans, offset) {
  for (const span of spans) {
    if (offset >= span.index && offset < span.index + span.text.length) return span;
  }
  return null;
}

function observation(rule, line, excerpt, message, hint) {
  return { rule, severity: 'warn', line, excerpt, message, hint };
}

function transitionDensity(paragraph, spans, table, out) {
  if (!table || spans.length < TRANSITION_MIN_SENTENCES) return;
  const opening = spans.filter((span) => startsWithTransition(span.text, table));
  const share = opening.length / spans.length;
  if (share <= TRANSITION_DENSITY) return;
  out.push(
    observation(
      'transition-density',
      lineAt(paragraph, opening[0].index),
      excerptOf(opening[0].text),
      `${opening.length} of ${spans.length} sentences in this paragraph open with a transition (${Math.round(share * 100)}%)`,
      'let the argument carry the connection; keep the connective only where the logical turn is real',
    ),
  );
}

function sentenceMonotony(paragraph, spans, out) {
  if (spans.length < MONOTONY_MIN_SENTENCES) return;
  const lengths = spans.map((span) => words(span.text).length);
  const mean = lengths.reduce((sum, n) => sum + n, 0) / lengths.length;
  const sd = Math.sqrt(lengths.reduce((sum, n) => sum + (n - mean) ** 2, 0) / lengths.length);
  if (sd >= MONOTONY_SD) return;
  out.push(
    observation(
      'sentence-monotony',
      paragraph.line,
      excerptOf(spans[0].text),
      `${spans.length} sentences of near-identical length (SD ${sd.toFixed(1)} words, mean ${mean.toFixed(1)})`,
      'vary the length: join two short sentences, or split the longest one at its real break',
    ),
  );
}

function repeatedOpenings(paragraph, spans, out) {
  const byOpening = new Map();
  for (const span of spans) {
    const head = opening(span.text, 2);
    if (head === '') continue;
    if (!byOpening.has(head)) byOpening.set(head, []);
    byOpening.get(head).push(span);
  }
  for (const [head, group] of [...byOpening.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (group.length < REPEATED_OPENING_MIN) continue;
    out.push(
      observation(
        'repeated-openings',
        lineAt(paragraph, group[0].index),
        excerptOf(group[0].text),
        `${group.length} sentences in this paragraph open with "${head}"`,
        'rewrite all but one opening; a repeated opening reads as a template, not an argument',
      ),
    );
  }
}

function phraseRule(rule, phrases, message, hint, paragraph, spans, out) {
  for (const hit of findPhrases(paragraph.text, phrases)) {
    const span = spanAt(spans, hit.index);
    out.push(
      observation(
        rule,
        lineAt(paragraph, hit.index),
        excerptOf(span ? span.text : hit.phrase),
        `${message}: "${hit.phrase}"`,
        hint,
      ),
    );
  }
}

function unsupportedIntensifiers(paragraph, spans, table, out) {
  if (!table) return;
  for (const span of spans) {
    if (CITATION.test(span.text) || EVIDENCE_MARKER.test(span.text)) continue;
    const seen = new Set();
    for (const hit of findPhrases(stripMarkup(span.text), table.intensifiers)) {
      if (seen.has(hit.phrase)) continue;
      seen.add(hit.phrase);
      out.push(
        observation(
          'unsupported-intensifier',
          lineAt(paragraph, span.index),
          excerptOf(span.text),
          `"${hit.phrase}" asserts importance in a sentence with no citation and no fact or result marker`,
          'cite the source, mark the number with <!-- fact: FACT-… -->, or drop the adjective',
        ),
      );
    }
  }
}

function vagueLiterature(paragraph, spans, table, out) {
  if (!table) return;
  for (const span of spans) {
    if (CITATION.test(span.text)) continue;
    const clean = stripMarkup(span.text);
    for (const pattern of table.vagueLiterature) {
      const match = new RegExp(pattern, 'iu').exec(clean);
      if (!match) continue;
      out.push(
        observation(
          'vague-literature',
          lineAt(paragraph, span.index),
          excerptOf(span.text),
          `"${match[0]}" refers to a body of work without citing any of it`,
          'name the studies with [@bibkey], or say what was found and where',
        ),
      );
    }
  }
}

function symmetricalLists(paragraph, out) {
  const lines = paragraph.text.split('\n');
  let run = [];
  const flush = () => {
    if (run.length >= LIST_RUN_MIN) {
      out.push(
        observation(
          'symmetrical-lists',
          paragraph.line + run[0].offset,
          excerptOf(run[0].item),
          `${run.length} consecutive list items open with "${run[0].word}"`,
          'vary the item openings, or fold the list back into prose that argues rather than enumerates',
        ),
      );
    }
    run = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const match = LIST_ITEM.exec(lines[i]);
    if (!match) {
      flush();
      continue;
    }
    const item = match[1];
    const word = (words(item)[0] ?? '').toLowerCase();
    if (word === '') {
      flush();
      continue;
    }
    if (run.length > 0 && run[0].word !== word) flush();
    run.push({ word, item, offset: i });
  }
  flush();
}

function excessiveHedging(paragraph, spans, table, out) {
  if (!table) return;
  for (const span of spans) {
    const hits = findPhrases(stripMarkup(span.text), table.hedges);
    if (hits.length < HEDGES_PER_SENTENCE_MIN) continue;
    const listed = [...new Set(hits.map((hit) => hit.phrase))].join(', ');
    out.push(
      observation(
        'excessive-hedging',
        lineAt(paragraph, span.index),
        excerptOf(span.text),
        `${hits.length} hedges in one sentence (${listed})`,
        'state the claim once at the strength the evidence supports; stacked hedges read as no claim at all',
      ),
    );
  }
}

function countByRule(observations) {
  const counts = Object.fromEntries(RULES.map((rule) => [rule, 0]));
  for (const item of observations) {
    if (counts[item.rule] !== undefined) counts[item.rule]++;
  }
  return counts;
}

function computeScores(observations, measurements) {
  const counts = countByRule(observations);
  const perHundred = Math.max(1, measurements.words / 100);
  const intensifiers = measurements.intensifierCount ?? 0;

  const specificity = clamp(
    100 -
      (15 * (counts['vague-literature'] + counts['banned-phrase'] + counts['empty-phrase'])) /
        perHundred,
  );

  const lengthVariation = Math.min(1, measurements.sdLen / 6);
  const structuralVariation =
    measurements.transitionRate === null
      ? clamp(100 * (0.5 * lengthVariation + 0.5 * measurements.openingDiversity))
      : clamp(
          100 *
            (0.4 * lengthVariation +
              0.4 * measurements.openingDiversity +
              0.2 * (1 - Math.min(1, measurements.transitionRate / TRANSITION_DENSITY))),
        );

  const conciseness = clamp(
    100 -
      (10 * (counts['empty-phrase'] + intensifiers)) / perHundred -
      3 * Math.max(0, measurements.meanLen - 30),
  );

  // Evidence alignment and epistemic precision are computed against the evidence graph and the
  // claim states, and author voice against the active profile - none of which lives in a text
  // file (PRD §39.1). The writing pipeline supplies them through gate-evidence and gate-voice;
  // a text-only run reports null rather than a number invented from prose alone.
  return {
    specificity,
    evidenceAlignment: null,
    epistemicPrecision: null,
    structuralVariation,
    authorVoice: null,
    conciseness,
  };
}

function aggregateOf(scores) {
  let weighted = 0;
  let total = 0;
  for (const name of SCORES) {
    if (scores[name] === null) continue;
    weighted += scores[name] * WEIGHTS[name];
    total += WEIGHTS[name];
  }
  return total === 0 ? null : clamp(weighted / total);
}

/**
 * Lints prose for the AI-writing patterns of PRD §29.1 and scores it on the six Academic Prose
 * Quality dimensions of PRD §39.1.
 *
 * Every observation is located (`line`) and quotable (`excerpt`), so a researcher can open the
 * text and disagree. Severity is `warn` for every rule in `full` mode and `block` in `ruthless`
 * mode (PRD §40); the language note is always `info`.
 *
 * @param {string} text
 * @param {{lang?: string, mode?: string, markers?: object|null, profile?: object|null}} [options]
 *   `markers` (claim/fact/result annotations resolved against the workspace) and `profile` (the
 *   active author voice profile) are the writing pipeline's inputs; without them the three
 *   scores that need the evidence graph or a voice profile are null.
 * @returns {{observations: object[], scores: object, formulas: object, aggregate: number|null,
 *   lang: string|null, stats: object}}
 */
export function lint(text, { lang = 'en', mode = 'full', markers = null, profile = null } = {}) {
  const source = String(text ?? '');
  const table = tableFor(lang);
  const paras = paragraphs(source);
  const observations = [];

  for (const paragraph of paras) {
    const spans = sentenceSpans(paragraph.text, lang);
    transitionDensity(paragraph, spans, table, observations);
    sentenceMonotony(paragraph, spans, observations);
    repeatedOpenings(paragraph, spans, observations);
    symmetricalLists(paragraph, observations);
    if (table) {
      phraseRule(
        'banned-phrase',
        table.banned,
        'generic phrasing that carries no research content',
        'say what was done, found or argued instead',
        paragraph,
        spans,
        observations,
      );
      phraseRule(
        'empty-phrase',
        table.empty,
        'filler that can be deleted without losing meaning',
        'delete the phrase and keep the sentence',
        paragraph,
        spans,
        observations,
      );
    }
    unsupportedIntensifiers(paragraph, spans, table, observations);
    vagueLiterature(paragraph, spans, table, observations);
    excessiveHedging(paragraph, spans, table, observations);
  }

  if (mode === 'ruthless') {
    for (const item of observations) item.severity = 'block';
  }

  if (!table) {
    observations.push({
      rule: 'unsupported-language',
      severity: 'info',
      line: 1,
      excerpt: '',
      message: `no prose resources ship for language "${normalizeLang(lang) ?? '(unset)'}"; only the structural rules ran (${STRUCTURAL_RULES.join(', ')})`,
      hint: 'run with --lang en or --lang es, or add a language table under src/domain/lang/',
    });
  }

  observations.sort(
    (a, b) =>
      a.line - b.line ||
      (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) ||
      (a.excerpt < b.excerpt ? -1 : a.excerpt > b.excerpt ? 1 : 0),
  );

  const measurements = stats(source, lang);
  const scores = computeScores(observations, measurements);

  return {
    observations,
    scores,
    formulas: { ...FORMULAS },
    aggregate: aggregateOf(scores),
    lang: normalizeLang(lang),
    stats: measurements,
    // What the caller supplied, so a renderer can say why a score is null rather than printing
    // a bare "n/a".
    inputs: { markers: markers !== null, profile: profile !== null },
  };
}
