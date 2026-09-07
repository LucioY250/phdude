import { normalizeLang, tableFor } from './lang/index.js';

// The only text-analysis primitives in PhDude. Every gate, the prose lint and the voice
// learning read their sentences, words and openings from here, so two features can never
// disagree about what a sentence is (plan Global Constraints).
//
// The sentence splitter is a deterministic regex-and-lookaround scanner, not a model. Its
// documented limits:
//
// - A boundary needs a terminator (`.`, `?`, `!`, `…`), whitespace, and a following capital,
//   digit or opening quote. A sentence that starts with a lowercase word (a gene name, a
//   variable) is joined to the sentence before it.
// - Abbreviations are protected by the per-language list, so a term the list does not carry
//   ("ibid.", a field-specific abbreviation) splits early. `etc.` is on the list, so a sentence
//   that genuinely ends with it is joined to the next one.
// - A single capital letter before a period reads as an initial ("J. Smith"), so a sentence
//   ending in a one-letter word ("… vitamin D. The") does not split.
// - Ellipses, decimals ("3.14") and ordered-list markers ("1. ") never split; a list item that
//   opens a line does end the sentence before it, even though its bullet is not a capital.
// - Language-dependent statistics are null for a language with no table; the structural ones
//   are computed the same way for every language.

const TERMINATORS = new Set(['.', '?', '!', '…']);
// A sentence that cites a source, or marks a number with the object it came from, has already
// declared where its emphasis comes from; `intensifierCount` leaves it alone.
const CITED = /\[@[^\]]+\]|<!--\s*(?:fact|result)\s*:/i;
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»', '›']);
const OPENERS = new Set(['"', "'", '“', '‘', '(', '[', '«', '¿', '¡']);
// A list item on its own line ends the sentence before it, even though `-` is not a capital.
const LIST_ITEM_START = /^(?:[-*+]|\d+[.)])[ \t]+\S/;
const ALNUM = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/;
const UPPER = /\p{Lu}/u;
const DIGIT = /\p{Nd}/u;

/**
 * Prose with its Markdown and PhDude annotation syntax removed: HTML comment markers, inline
 * code, `[@key]` citations, link and image syntax (the label survives), blockquote and list
 * markers, and emphasis runs. Word counts and openings are taken from this, never from the raw
 * line, so a citation-dense paragraph is not counted as long-winded.
 * @param {string} text
 * @returns {string}
 */
export function stripMarkup(text) {
  return String(text ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[@[^\]]*\]/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}>+[ \t]?/gm, '')
    .replace(/^[ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/[*_~]+/g, '')
    .trim();
}

/**
 * The prose paragraphs of a Markdown text, in order, each with the 1-based line its first line
 * sits on. Blank lines separate paragraphs; YAML front matter, ATX headings, thematic breaks and
 * fenced code blocks are dropped, because none of them is prose and all of them would distort
 * sentence length and paragraph density.
 * @param {string} text
 * @returns {{text: string, line: number}[]}
 */
export function paragraphs(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = [];
  let current = [];
  let startLine = 0;

  const flush = () => {
    if (current.length === 0) return;
    out.push({ text: current.join('\n'), line: startLine });
    current = [];
  };

  let i = 0;
  // YAML front matter, only when it opens on the very first line.
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    i++;
  }

  let fence = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^[ \t]{0,3}(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (fence === null) {
        flush();
        fence = fenceMatch[1][0];
      } else if (fenceMatch[1][0] === fence) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) continue;
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (/^[ \t]{0,3}#{1,6}[ \t]/.test(line)) {
      flush();
      continue;
    }
    if (/^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) {
      flush();
      continue;
    }
    if (current.length === 0) startLine = i + 1;
    current.push(line);
  }
  flush();
  return out;
}

/**
 * The 1-based line an offset falls on. Every located finding in the writing pipeline is built
 * from this, so a gate never counts newlines its own way.
 * @param {string} text
 * @param {number} index - an offset into `text`
 * @returns {number}
 */
export function lineAt(text, index) {
  const source = String(text ?? '');
  const upto = Math.max(0, Math.min(index, source.length));
  let line = 1;
  for (let i = 0; i < upto; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

function isDecimal(text, i) {
  return DIGIT.test(text[i - 1] ?? '') && DIGIT.test(text[i + 1] ?? '');
}

function isInitial(text, i) {
  const prev = text[i - 1];
  if (prev === undefined || !UPPER.test(prev)) return false;
  const before = text[i - 2];
  return before === undefined || !/\p{L}/u.test(before);
}

// "1. " and "  12) " open a list item; the period is a marker, not a terminator.
function isListMarker(text, i) {
  let j = i - 1;
  while (j >= 0 && DIGIT.test(text[j])) j--;
  if (j === i - 1) return false;
  while (j >= 0 && (text[j] === ' ' || text[j] === '\t')) j--;
  return j < 0 || text[j] === '\n';
}

function endsWithAbbreviation(text, i, abbreviations) {
  for (const abbr of abbreviations) {
    const start = i + 1 - abbr.length;
    if (start < 0) continue;
    if (text.slice(start, i + 1).toLowerCase() !== abbr) continue;
    const before = start === 0 ? undefined : text[start - 1];
    if (before === undefined || !ALNUM.test(before)) return true;
  }
  return false;
}

function isSentenceStart(ch) {
  if (ch === undefined) return false;
  return UPPER.test(ch) || DIGIT.test(ch) || OPENERS.has(ch);
}

/**
 * The sentences of a text with the offset each one starts at, so a caller can map a sentence
 * back to its line. Offsets are into `text` as given, before any markup stripping.
 * @param {string} text
 * @param {string} [lang] - decides which abbreviation list protects a period
 * @returns {{text: string, index: number}[]}
 */
export function sentenceSpans(text, lang) {
  const src = String(text ?? '');
  const abbreviations = tableFor(lang)?.abbreviations ?? [];
  const spans = [];
  let start = 0;

  const push = (from, to) => {
    const raw = src.slice(from, to);
    const value = raw.trim();
    if (value === '') return;
    spans.push({ text: value, index: from + (raw.length - raw.trimStart().length) });
  };

  for (let i = 0; i < src.length; i++) {
    if (!TERMINATORS.has(src[i])) continue;

    let end = i;
    while (end + 1 < src.length && TERMINATORS.has(src[end + 1])) end++;
    while (end + 1 < src.length && CLOSERS.has(src[end + 1])) end++;

    if (end + 1 >= src.length) {
      push(start, src.length);
      start = src.length;
      break;
    }

    // Scanned rather than sliced: a boundary test that copied the rest of the text would make
    // splitting a long section quadratic.
    let at = end + 1;
    let newline = false;
    while (at < src.length && WHITESPACE.test(src[at])) {
      if (src[at] === '\n') newline = true;
      at++;
    }
    if (at === end + 1) {
      i = end;
      continue;
    }

    if (src[i] === '.') {
      if (
        isDecimal(src, i) ||
        isListMarker(src, i) ||
        endsWithAbbreviation(src, i, abbreviations) ||
        isInitial(src, i)
      ) {
        i = end;
        continue;
      }
    }

    // A marker is at most a few characters ("12. ", "- "), so a short lookahead settles it.
    const startsListItem = newline && LIST_ITEM_START.test(src.slice(at, at + 12));
    if (!startsListItem && !isSentenceStart(src[at])) {
      i = end;
      continue;
    }

    push(start, end + 1);
    start = at;
    i = end;
  }

  if (start < src.length) push(start, src.length);
  return spans;
}

/**
 * @param {string} text
 * @param {string} [lang]
 * @returns {string[]} the sentences, trimmed, in order
 */
export function splitSentences(text, lang) {
  return sentenceSpans(text, lang).map((span) => span.text);
}

/**
 * The word tokens of one sentence: letters, digits and the inner apostrophes and hyphens that
 * hold a word together, with a decimal or thousands-separated number counted as one word.
 * @param {string} sentence
 * @returns {string[]}
 */
export function words(sentence) {
  return (
    stripMarkup(sentence).match(/\p{N}+(?:[.,]\p{N}+)+|[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu) ?? []
  );
}

/**
 * A sentence's opening, lowercased: the first `n` words joined by a space. Two sentences with
 * the same opening read as the same move, which is what `repeated-openings` and
 * `openingDiversity` measure.
 * @param {string} sentence
 * @param {number} [n]
 * @returns {string}
 */
export function opening(sentence, n = 2) {
  return words(sentence)
    .slice(0, n)
    .map((word) => word.toLowerCase())
    .join(' ');
}

function boundedAt(hay, at, length) {
  const before = at === 0 ? undefined : hay[at - 1];
  const after = hay[at + length];
  return (
    (before === undefined || !ALNUM.test(before)) && (after === undefined || !ALNUM.test(after))
  );
}

/**
 * Every whole-word occurrence of any phrase in `phrases`, sorted by position. Matching is
 * case-insensitive and literal: a phrase is found only with its own word order and spacing.
 * @param {string} text
 * @param {string[]} phrases - lowercase entries from a language table
 * @returns {{phrase: string, index: number}[]}
 */
export function findPhrases(text, phrases) {
  const hay = String(text ?? '').toLowerCase();
  const found = [];
  for (const phrase of phrases) {
    if (phrase === '') continue;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(phrase, from);
      if (at === -1) break;
      if (boundedAt(hay, at, phrase.length)) found.push({ phrase, index: at });
      from = at + phrase.length;
    }
  }
  return found.sort((a, b) => a.index - b.index || (a.phrase < b.phrase ? -1 : 1));
}

/**
 * Whether a sentence opens with one of the language's transition connectives, ignoring any
 * opening quotation or inverted punctuation.
 * @param {string} sentence
 * @param {object|null} table - a language table, or null for an unknown language
 * @returns {boolean}
 */
export function startsWithTransition(sentence, table) {
  if (!table) return false;
  const head = stripMarkup(sentence)
    .toLowerCase()
    .replace(/^[¿¡"'“‘(]+/, '')
    .trimStart();
  for (const transition of table.transitions) {
    if (!head.startsWith(transition)) continue;
    const after = head[transition.length];
    if (after === undefined || !ALNUM.test(after)) return true;
  }
  return false;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Descriptive statistics for a text. Structural fields are computed for any language; the
 * language-dependent ones (`transitionRate`, `firstPersonRate`, `hedgeRate`, `intensifierCount`)
 * are null when no table ships for `lang`, because a zero there would read as "this text uses no
 * transitions" rather than "PhDude cannot tell" (PRD §101). `intensifierCount` skips sentences
 * that carry a citation or a fact/result marker, the same sentences `unsupported-intensifier`
 * spares: an adjective next to its evidence is not the density the conciseness score measures.
 *
 * @param {string} text
 * @param {string} [lang]
 * @returns {{sentences: number, words: number, meanLen: number, sdLen: number,
 *   openingDiversity: number, transitionRate: number|null, firstPersonRate: number|null,
 *   hedgeRate: number|null, intensifierCount: number|null, paragraphDensity: number,
 *   lang: string|null}}
 */
export function stats(text, lang) {
  const table = tableFor(lang);
  const paras = paragraphs(text);
  const sentences = paras.flatMap((paragraph) => splitSentences(paragraph.text, lang));
  const count = sentences.length;

  const lengths = sentences.map((sentence) => words(sentence).length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const meanLen = count === 0 ? 0 : total / count;
  const variance =
    count === 0 ? 0 : lengths.reduce((sum, length) => sum + (length - meanLen) ** 2, 0) / count;

  const openings = new Set();
  for (const sentence of sentences) {
    const head = opening(sentence, 2);
    if (head !== '') openings.add(head);
  }

  let transitionSentences = 0;
  let firstPersonSentences = 0;
  let hedgeSentences = 0;
  let intensifierCount = 0;
  if (table) {
    for (const sentence of sentences) {
      const clean = stripMarkup(sentence);
      if (startsWithTransition(sentence, table)) transitionSentences++;
      if (findPhrases(clean, table.firstPerson).length > 0) firstPersonSentences++;
      if (findPhrases(clean, table.hedges).length > 0) hedgeSentences++;
      if (!CITED.test(sentence)) intensifierCount += findPhrases(clean, table.intensifiers).length;
    }
  }

  const rate = (n) => (count === 0 ? 0 : round(n / count, 4));

  return {
    sentences: count,
    words: total,
    meanLen: round(meanLen, 2),
    sdLen: round(Math.sqrt(variance), 2),
    openingDiversity: count === 0 ? 0 : round(openings.size / count, 4),
    transitionRate: table ? rate(transitionSentences) : null,
    firstPersonRate: table ? rate(firstPersonSentences) : null,
    hedgeRate: table ? rate(hedgeSentences) : null,
    intensifierCount: table ? intensifierCount : null,
    paragraphDensity: paras.length === 0 ? 0 : round(count / paras.length, 2),
    lang: normalizeLang(lang),
  };
}
