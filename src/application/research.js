import { join } from 'node:path';
import { applyFilters, dedupe, score } from '../domain/candidates.js';
import { newCandidate, newSearch } from '../domain/entities.js';
import { PhdudeError } from '../domain/errors.js';
import { makeId, parseId } from '../domain/ids.js';
import { assertNetworkAllowed, researchFilters } from '../domain/policy.js';
import { assertUpToDate } from './guard.js';

const POLICY_PATH = join('.phdude', 'research-policy.yaml');

const CANDIDATE_STATES = ['candidate', 'accepted', 'dismissed'];

const ALL_FAILED_HINT =
  'check the network connection and the providers listed in .phdude/research-policy.yaml';

function requireQuery(query) {
  const text = String(query ?? '').trim();
  if (!text) {
    throw new PhdudeError('USAGE', 'research needs a query', 'phdude research "<query>"');
  }
  return text;
}

// The providers a run will actually call. `deps.providers` is what the workspace configured
// (or what `--provider` asked for, resolved in the CLI); the option narrows that list without
// ever widening it, so a command can never reach a provider the policy did not name.
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
        `unknown provider ${name}`,
        `configured: ${[...byName.keys()].join(', ')}`,
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

/**
 * Runs one literature search across the configured providers and records what came back as
 * candidates the researcher still has to review. Nothing leaves the machine but the query text
 * (spec §3.1): the policy gate is checked first, every provider call is audited as its own
 * event, and no result payload is ever written to the event log.
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
  const effectiveFrom = from ?? filters.from;
  const effectiveLimit = limit ?? filters.limit;
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
    if (await store.readEntity(obj.id)) {
      existing.push(obj.id);
      continue;
    }
    await store.writeEntity(obj);
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
