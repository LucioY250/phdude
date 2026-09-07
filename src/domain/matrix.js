// Literature matrix (PRD S112, spec S3.4): one row per source, deterministic ordering, nothing
// invented — every field is derived straight from the objects already in the workspace.

const STRENGTH_RANK = { strong: 0, moderate: 1, weak: 2, unknown: 3 };

function strongestOf(strengths) {
  if (strengths.length === 0) return null;
  return [...strengths].sort((a, b) => STRENGTH_RANK[a] - STRENGTH_RANK[b])[0];
}

// Pack-declared method tags (spec S3.4): any `ext.<pack>.methods` array on the source,
// flattened in pack-name order. No pack ships this today; the field is forward-looking.
function methodsOf(source) {
  const ext = source.ext ?? {};
  const methods = [];
  for (const pack of Object.keys(ext).sort()) {
    const m = ext[pack]?.methods;
    if (Array.isArray(m)) methods.push(...m);
  }
  return methods;
}

function byYearDescThenBibkey(a, b) {
  if (a.year === null && b.year === null)
    return a.bibkey < b.bibkey ? -1 : a.bibkey > b.bibkey ? 1 : 0;
  if (a.year === null) return 1;
  if (b.year === null) return -1;
  if (a.year !== b.year) return b.year - a.year;
  return a.bibkey < b.bibkey ? -1 : a.bibkey > b.bibkey ? 1 : 0;
}

/**
 * Pure. One row per source: which research questions its evidence reaches (evidence -> claim
 * -> question, only evidence that cites the source id directly - the same "cited" definition
 * as `application/cite.js`), which claims reach it that way, the strongest strength among
 * evidence citing it directly, the facts extracted from its own artifacts, and any
 * pack-declared method tags.
 * @param {object} snapshot
 * @param {{keys: Map<string,string>, question?: string}} opts - `keys`: source id -> bibkey
 *   (see domain/bibkey.js assignBibkeys); `question`: optional RQ id to filter rows to
 * @returns {object[]}
 */
export function buildMatrix(snapshot, { keys, question } = {}) {
  const sources = snapshot.sources ?? [];
  const evidence = snapshot.evidence ?? [];
  const claims = snapshot.claims ?? [];
  const facts = snapshot.facts ?? [];

  const rows = sources.map((source) => {
    const citingEvidence = evidence.filter((e) => e.source === source.id);
    const citingEvidenceIds = new Set(citingEvidence.map((e) => e.id));

    const claimsReached = claims.filter((c) =>
      (c.supported_by ?? []).some((evId) => citingEvidenceIds.has(evId)),
    );
    const claimIds = [...new Set(claimsReached.map((c) => c.id))].sort();
    const questionIds = [...new Set(claimsReached.flatMap((c) => c.questions ?? []))].sort();

    const sourceArtifacts = new Set(source.artifacts ?? []);
    const factIds = facts
      .filter((f) => sourceArtifacts.has(f.from?.artifact))
      .map((f) => f.id)
      .sort();

    return {
      id: source.id,
      bibkey: keys.get(source.id),
      year: source.year ?? null,
      type: source.type,
      authors: source.authors ?? [],
      title: source.title,
      questions: questionIds,
      claims: claimIds,
      claimCount: claimIds.length,
      strongestEvidence: strongestOf(citingEvidence.map((e) => e.strength)),
      facts: factIds,
      methods: methodsOf(source),
      cited: citingEvidence.length > 0,
    };
  });

  const filtered = question ? rows.filter((r) => r.questions.includes(question)) : rows;
  return filtered.sort(byYearDescThenBibkey);
}
