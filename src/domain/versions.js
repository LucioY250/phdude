import { basename } from 'node:path';

const TRAILING_MARKER_RE = /[-_ ]?(v\d+|final|draft|copy|\(\d+\)|\d{4}-\d{2}-\d{2})$/;

function stemOf(path) {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  const name = dot <= 0 ? base : base.slice(0, dot);
  let stem = name.toLowerCase();
  let prev;
  do {
    prev = stem;
    stem = stem.replace(TRAILING_MARKER_RE, '');
  } while (stem !== prev);
  return stem;
}

/**
 * Pure: groups artifacts by normalized filename stem. Groups with two or more
 * distinct hashes are linked as versions of one another - the oldest by mtime
 * has no `versions_of` and `latest:false`, the newest has `latest:true`, and
 * every other member points `versions_of` at the oldest with `latest:false`.
 * Singleton stems (or stems whose members all share one hash) are returned
 * unchanged.
 * @param {object[]} artifacts
 * @returns {object[]}
 */
export function linkVersions(artifacts) {
  const groups = new Map();
  for (const a of artifacts) {
    const stem = stemOf(a.path);
    if (!groups.has(stem)) groups.set(stem, []);
    groups.get(stem).push(a);
  }

  const resultById = new Map(artifacts.map((a) => [a.id, { ...a }]));

  for (const group of groups.values()) {
    const distinctHashes = new Set(group.map((a) => a.hash));
    if (distinctHashes.size < 2) continue;

    const sorted = [...group].sort((a, b) => (a.mtime < b.mtime ? -1 : a.mtime > b.mtime ? 1 : 0));
    const oldestId = sorted[0].id;
    const newestId = sorted[sorted.length - 1].id;

    for (const a of sorted) {
      const r = resultById.get(a.id);
      if (a.id === oldestId) delete r.versions_of;
      else r.versions_of = oldestId;
      r.latest = a.id === newestId;
    }
  }

  return artifacts.map((a) => resultById.get(a.id));
}
