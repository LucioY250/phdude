// Deterministic BibTeX-style citation keys, PRD S37 / spec S3.3: <surname><year><firstword>,
// lowercased ASCII. A source may declare its own `bibkey`, which always wins over the derived
// one; derived keys back off with -2, -3... when they would collide with anything already
// assigned (an explicit key or another derived one), in id order.

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'for', 'and', 'to', 'with', 'from']);

function stripDiacritics(s) {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

// "Family, Given" is recognized by its comma: everything before it is the family name, taken
// as-is (not re-split on whitespace, so a multi-word family name like "de la Cruz" survives
// intact). Natural order ("Given Family") is unchanged: the last whitespace-separated token.
function surnameOf(authors) {
  const first = authors?.[0];
  if (!first) return 'anon';
  const raw = String(first).trim();
  const commaIndex = raw.indexOf(',');
  const family =
    commaIndex !== -1
      ? raw.slice(0, commaIndex).trim()
      : (raw.split(/\s+/).filter(Boolean).pop() ?? '');
  const cleaned = stripDiacritics(family)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return cleaned || 'anon';
}

function yearOf(year) {
  const digits = String(year ?? '').replace(/[^0-9]/g, '');
  return digits || 'nd';
}

// A word of 3 letters or fewer (e.g. "the", "AI") is skipped even when it is not itself a
// listed stopword - short words rarely make a bibkey recognizable.
function firstTitleWord(title) {
  const tokens = stripDiacritics(String(title ?? ''))
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  for (const raw of tokens) {
    const word = raw.replace(/[^a-z0-9]/g, '');
    if (word.length > 3 && !STOPWORDS.has(word)) return word;
  }
  return 'untitled';
}

/**
 * Pure. `<firstAuthorSurname><year><firstTitleWord>`, lowercased ASCII: diacritics are
 * stripped, non-letter/digit characters dropped, and the title word is the first token longer
 * than 3 letters that is not a stopword.
 * @param {{authors?: string[], year?: number, title?: string}} source
 * @returns {string}
 */
export function bibkeyFor(source) {
  return `${surnameOf(source.authors)}${yearOf(source.year)}${firstTitleWord(source.title)}`;
}

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pure. Assigns every source a unique bibkey: an explicit `source.bibkey` is honored as-is,
 * even when two sources declare the same one (that collision is a `duplicate-bibkey` finding
 * at check/export time, never thrown here); a derived key backs off with `-2`, `-3`... in id
 * order whenever it would collide with an explicit key or another derived one.
 * @param {object[]} sources
 * @returns {Map<string, string>} source id -> bibkey
 */
export function assignBibkeys(sources) {
  const ordered = [...sources].sort(byId);
  const map = new Map();
  const used = new Set();

  for (const source of ordered) {
    if (source.bibkey) {
      map.set(source.id, source.bibkey);
      used.add(source.bibkey);
    }
  }

  for (const source of ordered) {
    if (source.bibkey) continue;
    const base = bibkeyFor(source);
    let key = base;
    let suffix = 2;
    while (used.has(key)) {
      key = `${base}-${suffix}`;
      suffix++;
    }
    used.add(key);
    map.set(source.id, key);
  }

  return map;
}
