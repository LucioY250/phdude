export function normalizeText(s) {
  return String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}
export function normalizeKey(s) {
  return normalizeText(s)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
