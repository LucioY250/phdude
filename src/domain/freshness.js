// How current the workspace's literature is (PRD §113, spec §3.4). Pure: the present is passed
// in as data, never read from a clock here, so every report is reproducible from its inputs.

const DAY_MS = 86400000;

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Per research question: when it was last searched, how long ago that was, and whether the
 * policy considers that stale. A question nobody has ever searched is stale by definition -
 * there is no literature behind it at all, which is the more urgent case, not the exempt one.
 *
 * A search whose `last_run` cannot be read is not counted: an unusable timestamp must not be
 * able to present a question as freshly searched.
 * @param {object[]} questions - question objects; rows come back in this order
 * @param {object[]} searches - every recorded search
 * @param {string} now - ISO timestamp the report is relative to
 * @param {number} staleAfterDays - `research.freshness.stale_after_days` from the policy
 * @returns {{question: string, lastSearch: string|null, daysAgo: number|null, stale: boolean,
 *   searches: number}[]}
 */
export function questionFreshness(questions, searches, now, staleAfterDays) {
  const at = timestamp(now) ?? 0;

  return (questions ?? []).map((question) => {
    const runs = (searches ?? [])
      .filter((search) => search.question === question.id)
      .map((search) => ({ iso: search.last_run, ms: timestamp(search.last_run) }))
      .filter((run) => run.ms !== null);

    const newest = runs.reduce(
      (best, run) => (best === null || run.ms > best.ms ? run : best),
      null,
    );
    const daysAgo = newest === null ? null : Math.floor((at - newest.ms) / DAY_MS);

    return {
      question: question.id,
      lastSearch: newest?.iso ?? null,
      daysAgo,
      // The threshold day itself counts as stale: "stale after 180 days" means a search that
      // has been sitting for 180 days is due, not due tomorrow.
      stale: daysAgo === null || daysAgo >= staleAfterDays,
      searches: runs.length,
    };
  });
}

/**
 * The recorded searches due to be run again. A search whose `last_run` cannot be read is due
 * for the same reason a never-searched question is stale: nothing on the record says it is
 * current.
 * @param {object[]} searches
 * @param {string} now - ISO timestamp the report is relative to
 * @param {number} staleAfterDays
 * @returns {object[]} the stale searches, in the order they came in
 */
export function staleSearches(searches, now, staleAfterDays) {
  const at = timestamp(now) ?? 0;

  return (searches ?? []).filter((search) => {
    const ms = timestamp(search.last_run);
    return ms === null || Math.floor((at - ms) / DAY_MS) >= staleAfterDays;
  });
}

/**
 * How old each recorded source is, in years. A source without a year has no age rather than an
 * invented one.
 * @param {object[]} sources
 * @param {string} now - ISO timestamp the report is relative to
 * @returns {{id: string, year: number|null, age: number|null}[]}
 */
export function sourceAges(sources, now) {
  const currentYear = new Date(timestamp(now) ?? 0).getUTCFullYear();

  return (sources ?? []).map((source) => {
    const year = Number.isInteger(source.year) ? source.year : null;
    return { id: source.id, year, age: year === null ? null : currentYear - year };
  });
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param {object[]} questionRows - from `questionFreshness`
 * @param {object[]} sourceRows - from `sourceAges`
 * @param {object[]} searches - every recorded search, including those tied to no question
 * @returns {{questions: number, stale: number, neverSearched: number, searches: number,
 *   sources: number, medianAge: number|null, oldest: number|null}}
 */
export function summary(questionRows, sourceRows, searches) {
  const ages = (sourceRows ?? []).map((row) => row.age).filter((age) => age !== null);

  return {
    questions: (questionRows ?? []).length,
    stale: (questionRows ?? []).filter((row) => row.stale).length,
    neverSearched: (questionRows ?? []).filter((row) => row.lastSearch === null).length,
    searches: (searches ?? []).length,
    sources: (sourceRows ?? []).length,
    medianAge: median(ages),
    oldest: ages.length === 0 ? null : Math.max(...ages),
  };
}
