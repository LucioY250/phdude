# 0007 — Network policy and search providers

**Status:** accepted
**Date:** 2026-09-07

## Context

PhDude must find current literature, which means leaving the machine. It also holds unpublished
research, so "local and private unless explicitly configured otherwise" (PRD §71) cannot bend for
convenience. Five provider APIs are planned, each with its own vocabulary, error style and rate
limits, and none of them may be reachable from a test run.

## Decision

Network access is closed by default and opened in exactly two places: `network.enabled: true` in
`.phdude/research-policy.yaml`, or `--allow-network` on the command. `src/domain/policy.js` is the
only thing that decides, as a pure function, and refuses with `PhdudeError('POLICY', …)` naming
both ways in. Only the query string ever leaves the machine.

Providers sit behind one port, `src/ports/search-provider.js`: a `search(query, { from, limit,
signal })` returning normalized `Candidate` objects, so the domain never sees a provider's
vocabulary. The port ships its own contract suite; an adapter is correct when it passes it.

`fetch` is injected through `deps`, never imported. `src/adapters/search/http.js` carries the
shared policy: a 15 s `AbortController` timeout merged with the caller's signal, exactly one retry
on 429/503 with a backoff capped at 2 s, a `phdude/<version>` User-Agent, and typed errors — a
provider that is unwell is `TOOL_MISSING`, a request we got wrong is `VALIDATION`. Responses are
untrusted input (PRD §74): every field is validated before mapping, and a work without a title or
an id is dropped rather than half-mapped. OpenAlex and Crossref get the polite `mailto` from the
author profile when one is set.

## Consequences

- Tests never touch the network: `tests/support/fake-fetch.js` replays recorded routes, and an
  unmatched URL throws. Live checks stay behind `PHDUDE_LIVE_TESTS=1`.
- A new provider is one adapter plus one entry in `PROVIDER_FACTORIES`, proven by the contract
  suite over its own fixtures.
- `doctor` reports the policy and the configured providers without calling anything.
- Provider outages degrade a search rather than failing the command, because their errors are
  typed and named.
- The cost is a normalization layer: fields a provider reports and the `Candidate` shape does not
  are dropped at the adapter boundary.
