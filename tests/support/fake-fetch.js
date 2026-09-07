// The implementation lives under src/ because run.js's `PHDUDE_FAKE_FETCH` hook needs it too,
// and src/ cannot import from tests/. This re-export keeps every test importing it from the
// place a test helper belongs.
export { fakeFetch, fakeFetchFromFile } from '../../src/adapters/search/fake-fetch.js';
