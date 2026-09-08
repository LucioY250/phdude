# search-provider-example

A third-party [`SearchProvider`](../../../docs/extension-api.md#searchprovider). It queries a
fictional literature API at `https://api.example.org/v1/works` and maps the answers into
PhDude's `Candidate` shape.

```js
import { exampleProvider } from './index.js';

const provider = exampleProvider({ fetch, version: '1.0.0' });
const candidates = await provider.search('open science', { from: 2021, limit: 10 });
```

## What it demonstrates

- **`fetch` is injected, never imported.** That is what lets the contract suite replay recorded
  responses and never reach the network.
- **The full `Candidate` shape, every time.** Twelve keys, no more and no fewer, with `null`
  where the API said nothing rather than a guess.
- **A work it cannot name or address is dropped.** The recorded response carries an untitled
  record; it never becomes a half-mapped candidate.
- **DOIs are normalized.** Lowercase, bare `10.xxxx/...`, never the resolver URL — one recorded
  DOI arrives with the `https://doi.org/` prefix so the mapping is exercised.
- **`limit` is a promise the provider keeps**, whatever the API returned.
- **One retry, on 429 and 503 only**, with the backoff the provider asked for, capped at 2 s.
- **Typed errors.** A 5xx is `TOOL_MISSING`, a non-429 4xx is `VALIDATION`, a body that is not
  JSON is `VALIDATION`, and an aborted request is `TOOL_MISSING` naming the provider.

`from` is forwarded to the API as `from_year`, because this one filters by date server-side. A
provider whose API cannot sets `filtersDateClientSide: true` and filters its own results; the
contract suite then checks the results instead of the request URL.

## Fixtures

`fixtures/` holds the recorded responses the contract run replays — a successful search, an empty
one, and a body that is not JSON. Recording your own is the whole cost of adopting the suite.

## Running its contract suite

```
node --test tests/contracts/example-extensions.test.js
```

MIT licensed. Nothing here imports PhDude.
