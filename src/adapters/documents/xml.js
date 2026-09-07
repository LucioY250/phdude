const NAMED_ENTITIES = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&apos;/g, "'"],
  [/&amp;/g, '&'],
];

/**
 * Decodes the five predefined XML entities and numeric character references
 * (`&#NN;` and `&#xHH;`). Numeric references are decoded first so a literal
 * `&amp;` in the source is never re-interpreted as part of another entity.
 * @param {string} inner
 * @returns {string}
 */
export function textOf(inner) {
  let out = inner
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
  for (const [re, replacement] of NAMED_ENTITIES) out = out.replace(re, replacement);
  return out;
}

function parseAttrs(raw) {
  const attrs = {};
  if (!raw) return attrs;
  const re = /([a-zA-Z_][\w:.-]*)\s*=\s*"([^"]*)"|([a-zA-Z_][\w:.-]*)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(raw))) {
    const key = m[1] ?? m[3];
    const value = m[2] ?? m[4];
    attrs[key] = textOf(value);
  }
  return attrs;
}

/**
 * Finds every (non-nested) occurrence of a tag by name, handling self-closing
 * tags and namespaced names (`w:p`, `a:t`). Not a general XML parser: it
 * assumes elements of the given name never nest inside one another, which
 * holds for every tag this adapter looks up in OOXML documents.
 * @param {string} xml
 * @param {string} name
 * @returns {{attrs: object, inner: string}[]}
 */
export function tags(xml, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRe = new RegExp(`<${esc}(?=[\\s/>])([^>]*?)(/?)>`, 'g');
  const closeTag = `</${name}>`;
  const out = [];
  let m;
  while ((m = openRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    if (m[2] === '/') {
      out.push({ attrs, inner: '' });
      continue;
    }
    const start = openRe.lastIndex;
    const end = xml.indexOf(closeTag, start);
    if (end === -1) {
      out.push({ attrs, inner: '' });
      continue;
    }
    out.push({ attrs, inner: xml.slice(start, end) });
    openRe.lastIndex = end + closeTag.length;
  }
  return out;
}
