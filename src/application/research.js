import { join } from 'node:path';
import {
  applyFilters,
  dedupe,
  identityKey,
  identityKeys,
  score,
  titleKey,
} from '../domain/candidates.js';
import { newCandidate, newSearch, newSource } from '../domain/entities.js';
import { PhdudeError } from '../domain/errors.js';
import { staleSearches } from '../domain/freshness.js';
import { makeId, parseId } from '../domain/ids.js';
import { normalizeDoi } from '../domain/normalize.js';
import { assertNetworkAllowed, researchFilters } from '../domain/policy.js';
import { assertUpToDate } from './guard.js';

const POLICY_PATH = join('.phdude', 'research-policy.yaml');

const CANDIDATE_STATES = ['candidate', 'accepted', 'dismissed'];

// What a candidate's `type` becomes on the Source it is accepted as. Every candidate type is
// also a source type, so the map is an identity; anything a future provider invents lands on
// `other` rather than writing a value the source schema will refuse.
const SOURCE_TYPE_BY_CANDIDATE_TYPE = {
  article: 'article',
  preprint: 'preprint',
  book: 'book',
  chapter: 'chapter',
  other: 'other',
};

const SOURCE_TYPES = [
  'article',
  'book',
  'chapter',
  'thesis',
  'report',
  'preprint',
  'web',
  'dataset',
  'other',
];

const ALL_FAILED_HINT =
  'check the network connection and the providers listed in .phdude/research-policy.yaml';

function requireQuery(query) {
  const text = String(query ?? '').trim();
  if (!text) {
    throw new PhdudeError('USAGE', 'research needs a query', 'phdude research "<query>"');
  }
  return text;
}

// The providers a run will actually call. `deps.providers` is what the workspace policy
// configured; a name asked for here - by `--provider`, or by a stored search being re-run - can
// only narrow that list, so a command can never reach a provider the policy did not name.
function selectProviders(available, names) {
  if (!Array.isArray(available) || available.length === 0) {
    throw new PhdudeError(
      'USAGE',
      'no search providers are configured',
      'list providers in .phdude/research-policy.yaml or pass --provider <name>',
    );
  }
  if (!names || names.length === 0) return available;

  const byName = new Map(available.map((provider) => [provider.name, provider]));
  return names.map((name) => {
    const provider = byName.get(name);
    if (!provider) {
      throw new PhdudeError(
        'USAGE',
        `provider ${name} is not in the workspace policy`,
        'add it to providers: in .phdude/research-policy.yaml',
      );
    }
    return provider;
  });
}

async function assertQuestionExists(store, question) {
  if (question === null || question === undefined) return null;
  if (parseId(question)?.type !== 'question') {
    throw new PhdudeError(
      'VALIDATION',
      `not a research question: ${question}`,
      'pass --question RQ-<n>',
    );
  }
  const obj = await store.readEntity(question);
  if (!obj) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown question ${question}`,
      'run phdude knowledge list --type question',
    );
  }
  return question;
}

// What the run applied, recorded on the search so a reader a year later knows which filters
// produced this list - and so `research-fresh` can re-run it the same way.
function filterSnapshot(filters, from, limit) {
  return {
    from,
    limit,
    languages: filters.languages,
    peer_reviewed: filters.peerReviewed,
    preprints_require_approval: filters.preprintsRequireApproval,
  };
}

function mergeNames(existing, added) {
  const names = Array.isArray(existing) ? [...existing] : [];
  for (const name of added) if (!names.includes(name)) names.push(name);
  return names;
}

// Every candidate already on disk, reachable by either key that can identify a work. A run
// needs both: the id it is about to mint comes from the DOI when a provider reported one,
// while the record on disk may have been filed under the title key by an earlier run whose
// provider did not know that DOI yet.
async function indexStoredCandidates(store) {
  const index = new Map();
  for (const candidate of await store.listEntities('candidate'))
    registerCandidate(index, candidate);
  return index;
}

function registerCandidate(index, candidate) {
  for (const key of identityKeys(candidate)) if (!index.has(key)) index.set(key, candidate);
}

// The carry-over case content-derived ids cannot cover on their own: an earlier run recorded
// this work under its title because its provider reported no DOI, and this run has one. The
// work is not new, so the record is filled in and keeps the id it already has rather than the
// same paper being filed twice (spec §3.3).
function carryOverDoi(index, candidate) {
  const key = titleKey(candidate);
  const record = key === null ? null : index.get(key);
  if (!record || record.doi !== null) return null;

  const ids = { ...record.ext?.ids, ...candidate.ext?.ids };
  if (candidate.provider !== record.provider) ids[candidate.provider] = candidate.external_id;
  delete ids[record.provider];

  const merged = {
    ...record,
    doi: candidate.doi,
    url: record.url ?? candidate.url,
    providers: mergeNames(record.providers, candidate.providers ?? [candidate.provider]),
  };
  if (Object.keys(ids).length > 0) merged.ext = { ...record.ext, ids };
  return merged;
}

/**
 * Runs one literature search across the configured providers and records what came back as
 * candidates the researcher still has to review. Nothing from the workspace's documents leaves
 * the machine (spec §3.1) - the call carries the query and the policy's filters, and nothing
 * else: the policy gate is checked first, every provider call is audited as its own event, and
 * no result payload is ever written to the event log.
 *
 * A provider that fails costs a warning, not the run: the others still contribute, because a
 * half-answered search beats no answer. Only a run where every provider failed is an error.
 * @param {{store: object, clock: () => string, actor: object,
 *   providers: import('../ports/search-provider.js').SearchProvider[]}} deps
 * @param {{query: string, question?: string|null, providers?: string[], from?: number|null,
 *   limit?: number|null, allowNetwork?: boolean}} opts
 * @returns {Promise<{search: object, candidates: {created: string[], existing: string[]},
 *   warnings: string[]}>}
 */
export async function search(
  { store, clock, actor, providers },
  { query, question = null, providers: providerNames, from, limit, allowNetwork = false } = {},
) {
  assertUpToDate(await store.readProject());

  const policy = await store.readYaml(POLICY_PATH);
  assertNetworkAllowed(policy, { allowNetwork });

  const text = requireQuery(query);
  const questionId = await assertQuestionExists(store, question);

  const filters = researchFilters(policy);
  // `undefined` means "the caller said nothing"; an explicit `null` means "no lower bound",
  // which is what a recorded search's snapshot carries when the policy had no `from` the day
  // it ran. `research-fresh` re-runs a search as it ran, so the two cannot collapse.
  const effectiveFrom = from === undefined ? filters.from : from;
  const effectiveLimit = limit === undefined ? filters.limit : limit;
  const selected = selectProviders(providers, providerNames);

  const at = clock();
  const warnings = [];
  const results = [];
  const calls = [];

  for (const provider of selected) {
    try {
      const hits = await provider.search(text, { from: effectiveFrom, limit: effectiveLimit });
      results.push(...hits);
      calls.push({ provider: provider.name, count: hits.length, ok: true });
    } catch (err) {
      // Provider errors already name their provider; prefixing an unnamed one keeps every
      // warning in the same `<provider>: <what went wrong>` shape without stuttering.
      const message = err.message.startsWith(`${provider.name}: `)
        ? err.message
        : `${provider.name}: ${err.message}`;
      warnings.push(message);
      calls.push({ provider: provider.name, count: 0, ok: false });
    }
  }

  if (!calls.some((call) => call.ok)) {
    throw new PhdudeError('TOOL_MISSING', 'all providers failed', ALL_FAILED_HINT, warnings);
  }

  // The client-side pass uses the same `from` the providers were given, not the policy's, so
  // `--from` narrows the result set even for a provider that ignored the server-side filter.
  const applied = { ...filters, from: effectiveFrom, currentYear: Number(at.slice(0, 4)) };
  const ranked = applyFilters(dedupe(results), applied).map((candidate, rank) => ({
    ...candidate,
    ...score(candidate, rank, applied),
  }));

  const searchId = makeId('search', `${text}|${questionId ?? ''}`);
  const created = [];
  const existing = [];
  const newByProvider = new Map();
  const stored = await indexStoredCandidates(store);

  for (const candidate of ranked) {
    const obj = newCandidate({
      ...candidate,
      query: text,
      question: questionId,
      search: searchId,
      actor,
      created: at,
    });
    // A candidate already on disk keeps the state, score and reason the researcher gave it:
    // re-running a search must never quietly reset a review that already happened.
    const known = stored.get(identityKey(obj));
    if (known) {
      existing.push(known.id);
      continue;
    }

    const carried = normalizeDoi(obj.doi) === null ? null : carryOverDoi(stored, obj);
    if (carried) {
      await store.writeEntity(carried);
      registerCandidate(stored, carried);
      existing.push(carried.id);
      continue;
    }

    await store.writeEntity(obj);
    registerCandidate(stored, obj);
    created.push(obj.id);
    newByProvider.set(obj.provider, (newByProvider.get(obj.provider) ?? 0) + 1);
  }

  // One run entry per provider call, so the search's history says which provider was asked
  // when, how much it returned, and how much of that was not already known.
  const runs = calls
    .filter((call) => call.ok)
    .map((call) => ({
      at,
      provider: call.provider,
      count: call.count,
      new: newByProvider.get(call.provider) ?? 0,
    }));

  const previous = await store.readEntity(searchId);
  const searchObj = previous
    ? {
        ...previous,
        providers: mergeNames(
          previous.providers,
          runs.map((run) => run.provider),
        ),
        filters: filterSnapshot(filters, effectiveFrom, effectiveLimit),
        runs: [...previous.runs, ...runs],
        last_run: at,
      }
    : newSearch({
        query: text,
        question: questionId,
        providers: runs.map((run) => run.provider),
        filters: filterSnapshot(filters, effectiveFrom, effectiveLimit),
        runs,
        last_run: at,
        actor,
        created: at,
      });
  await store.writeEntity(searchObj);

  // The audit trail of what left the machine: one event per provider call, carrying the query
  // and a count, never a single result (spec §3.1, PRD §71-§77).
  for (const call of calls) {
    await store.appendEvent({
      ts: at,
      op: 'search',
      actor,
      ids: [searchId],
      summary: call.ok
        ? `${call.provider}: "${text}" → ${call.count} results`
        : `${call.provider}: "${text}" → failed`,
    });
  }

  return { search: searchObj, candidates: { created, existing }, warnings };
}

/**
 * @param {{store: object}} deps
 * @param {{state?: string, question?: string}} [opts]
 * @returns {Promise<object[]>} candidates, highest score first
 */
export async function list({ store }, { state, question } = {}) {
  if (state !== undefined && !CANDIDATE_STATES.includes(state)) {
    throw new PhdudeError(
      'USAGE',
      `unknown state: ${state}`,
      `valid states: ${CANDIDATE_STATES.join(', ')}`,
    );
  }

  let candidates = await store.listEntities('candidate');
  if (state) candidates = candidates.filter((c) => c.state === state);
  if (question) candidates = candidates.filter((c) => c.question === question);

  return candidates.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * @param {{store: object}} deps
 * @param {string} id - a CAND or SEARCH id
 * @returns {Promise<object>}
 */
export async function show({ store }, id) {
  const type = parseId(id)?.type;
  if (type !== 'candidate' && type !== 'search') {
    throw new PhdudeError(
      'USAGE',
      `not a candidate or search id: ${id}`,
      'phdude research show <CAND-id|SEARCH-id>',
    );
  }
  const obj = await store.readEntity(id);
  if (!obj) throw new PhdudeError('USAGE', `not found: ${id}`, 'run phdude research list');
  return obj;
}

// A candidate the researcher is about to rule on: it has to exist, and it has to still be
// awaiting a verdict. Re-deciding an accepted candidate would orphan the Source it created,
// and re-deciding a dismissed one would quietly overwrite the reason it was dismissed for.
async function loadPendingCandidate(store, id, verb) {
  if (parseId(id)?.type !== 'candidate') {
    throw new PhdudeError(
      'USAGE',
      `not a candidate id: ${id}`,
      `phdude research ${verb} <CAND-id>`,
    );
  }
  const candidate = await store.readEntity(id);
  if (!candidate) {
    throw new PhdudeError('USAGE', `not found: ${id}`, 'run phdude research list');
  }
  if (candidate.state !== 'candidate') {
    throw new PhdudeError(
      'POLICY',
      `${id} was already ${candidate.state}`,
      `run phdude research show ${id} to see what was decided and when`,
    );
  }
  return candidate;
}

// The id one provider gave the work, wherever it ended up: `ext.ids` carries every provider's
// id except the one that owns the record, whose own id is `external_id`.
function providerId(candidate, provider) {
  if (candidate.provider === provider) return candidate.external_id;
  const id = candidate.ext?.ids?.[provider];
  return typeof id === 'string' && id ? id : null;
}

// Only identifiers a provider actually reported, and only in the shape the source schema
// accepts. A DOI that does not parse as one is left out rather than written and then flagged
// by `cite check` forever after.
function identifiersOf(candidate) {
  const identifiers = {};
  const doi = normalizeDoi(candidate.doi);
  if (doi) identifiers.doi = doi;
  if (typeof candidate.url === 'string' && candidate.url) identifiers.url = candidate.url;
  const arxiv = providerId(candidate, 'arxiv');
  if (arxiv) identifiers.arxiv = arxiv;
  const pmid = providerId(candidate, 'pubmed');
  if (pmid) identifiers.pmid = pmid;
  return Object.keys(identifiers).length > 0 ? identifiers : undefined;
}

/**
 * Accepts a reviewed candidate into the citation registry as a Source (spec §3.4, §3.6). This
 * is the only path from a search result to knowledge, and it is deliberately one candidate at
 * a time: the researcher has read this one and said yes to this one.
 *
 * A preprint the policy flagged needs `approvePreprint` - the flag is the researcher's answer,
 * never the agent's shortcut. Nothing the provider did not report is invented: a missing year,
 * venue or abstract stays missing, and `cite check` reports it afterwards.
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} id - a CAND id
 * @param {{type?: string, approvePreprint?: boolean}} [opts]
 * @returns {Promise<{candidate: object, source: object, created: boolean}>} `created` is false
 *   when the workspace already recorded that source and the candidate was linked to it
 */
export async function accept({ store, clock, actor }, id, { type, approvePreprint = false } = {}) {
  assertUpToDate(await store.readProject());

  if (type !== undefined && !SOURCE_TYPES.includes(type)) {
    throw new PhdudeError(
      'USAGE',
      `unknown source type: ${type}`,
      `valid types: ${SOURCE_TYPES.join(', ')}`,
    );
  }

  const candidate = await loadPendingCandidate(store, id, 'accept');

  if (candidate.needs_approval === true && approvePreprint !== true) {
    throw new PhdudeError(
      'USAGE',
      `${id} is a preprint and this workspace requires approval before one is accepted`,
      'ask the researcher, then re-run with --approve-preprint ' +
        '(research.preprints.require_approval in .phdude/research-policy.yaml)',
    );
  }

  const at = clock();
  const source = newSource({
    title: candidate.title,
    authors: candidate.authors ?? [],
    year: candidate.year ?? undefined,
    venue: candidate.venue ?? undefined,
    type: type ?? SOURCE_TYPE_BY_CANDIDATE_TYPE[candidate.type] ?? 'other',
    identifiers: identifiersOf(candidate),
    abstract: candidate.abstract ?? undefined,
    provenance: { method: 'imported', derived_from: [] },
    ext: {
      research: {
        candidate: candidate.id,
        provider: candidate.provider,
        external_id: candidate.external_id,
        accepted_by: actor,
      },
    },
    actor,
    created: at,
  });

  // A source the workspace already records is linked to, not rewritten: its state, bibkey and
  // artifacts belong to whoever recorded it first, and accepting a second candidate for the
  // same work must not undo any of that.
  const recorded = await store.readEntity(source.id);
  if (!recorded) await store.writeEntity(source);

  const accepted = { ...candidate, state: 'accepted', accepted_as: source.id };
  await store.writeEntity(accepted);

  await store.appendEvent({
    ts: at,
    op: 'research',
    actor,
    ids: [candidate.id, source.id],
    summary: `accepted ${candidate.id} as ${source.id}`,
  });

  return { candidate: accepted, source: recorded ?? source, created: recorded === null };
}

/**
 * Records that a reviewed candidate is not going into the registry, and why. The reason is
 * required: a dismissed candidate keeps coming back in every future search, and the next
 * reader needs to know it was looked at rather than missed.
 * @param {{store: object, clock: () => string, actor: object}} deps
 * @param {string} id - a CAND id
 * @param {{reason?: string}} [opts]
 * @returns {Promise<object>} the dismissed candidate
 */
export async function dismiss({ store, clock, actor }, id, { reason } = {}) {
  assertUpToDate(await store.readProject());

  const text = String(reason ?? '').trim();
  if (!text) {
    throw new PhdudeError(
      'USAGE',
      'research dismiss needs a reason',
      'phdude research dismiss <CAND-id> --reason "…"',
    );
  }

  const candidate = await loadPendingCandidate(store, id, 'dismiss');
  const at = clock();
  const dismissed = { ...candidate, state: 'dismissed', reason: text };
  await store.writeEntity(dismissed);

  await store.appendEvent({
    ts: at,
    op: 'research',
    actor,
    ids: [candidate.id],
    summary: `dismissed ${candidate.id}: ${text}`,
  });

  return dismissed;
}

/**
 * Re-runs the searches whose results have aged past the policy's `stale_after_days`, exactly
 * as they were run the first time: the same query, question, providers and filters, read back
 * off the SEARCH record (spec §3.4). What it reports is only what is *new* - a re-run that
 * finds the same literature again is the answer "nothing has changed", and saying so in one
 * line beats listing the same twenty papers a second time.
 * @param {{store: object, clock: () => string, actor: object,
 *   providers: import('../ports/search-provider.js').SearchProvider[]}} deps
 * @param {{question?: string|null, all?: boolean, allowNetwork?: boolean}} [opts]
 * @returns {Promise<{reran: string[], newCandidates: string[], warnings: string[]}>}
 */
export async function fresh(deps, { question = null, all = false, allowNetwork = false } = {}) {
  const { store, clock } = deps;
  assertUpToDate(await store.readProject());

  const policy = await store.readYaml(POLICY_PATH);
  assertNetworkAllowed(policy, { allowNetwork });

  const questionId = await assertQuestionExists(store, question);
  const recorded = await store.listEntities('search');
  const scoped = questionId === null ? recorded : recorded.filter((s) => s.question === questionId);
  const { staleAfterDays } = researchFilters(policy);
  const due = all ? scoped : staleSearches(scoped, clock(), staleAfterDays);

  const reran = [];
  const newCandidates = [];
  const warnings = [];
  const available = new Set((deps.providers ?? []).map((provider) => provider.name));

  for (const record of due) {
    // Removing a provider from the policy is an ordinary config edit, and every search recorded
    // before it still names the provider it ran against. Re-run what is left and say what was
    // dropped; a stored list that no longer overlaps the policy at all is one unrunnable
    // record, not a reason to discard every other re-run in this invocation.
    const recorded = record.providers ?? [];
    const runnable = recorded.filter((name) => available.has(name));
    const dropped = recorded.filter((name) => !available.has(name));
    if (dropped.length > 0) {
      const what = `provider(s) ${dropped.join(', ')} no longer configured`;
      if (runnable.length === 0) {
        warnings.push(`skipped ${record.id}: ${what}`);
        continue;
      }
      warnings.push(`${record.id}: ${what}`);
    }

    let result;
    try {
      result = await search(deps, {
        query: record.query,
        question: record.question,
        providers: runnable,
        from: record.filters?.from,
        limit: record.filters?.limit ?? undefined,
        allowNetwork,
      });
    } catch (err) {
      // A stored search can outlive what it points at - a question deleted by hand, say. That
      // is one unrunnable record, not a reason to throw away every re-run already done in this
      // invocation, so it is reported the way a failing provider is and the loop carries on.
      if (err?.code !== 'VALIDATION') throw err;
      warnings.push(`skipped ${record.id}: ${err.message}`);
      continue;
    }
    reran.push(record.id);
    newCandidates.push(...result.candidates.created);
    warnings.push(...result.warnings);
  }

  return { reran, newCandidates, warnings };
}
