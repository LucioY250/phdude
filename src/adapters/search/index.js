import { PhdudeError } from '../../domain/errors.js';
import { arxiv } from './arxiv.js';
import { crossref } from './crossref.js';
import { openalex } from './openalex.js';
import { pubmed } from './pubmed.js';
import { semanticScholar } from './semantic-scholar.js';

/** Every provider this build can search. The policy's `providers:` list names these. */
export const PROVIDER_FACTORIES = {
  openalex,
  crossref,
  arxiv,
  'semantic-scholar': semanticScholar,
  pubmed,
};

/**
 * Builds the providers a search will run, in the order the workspace asked for them.
 * @param {string[]} names
 * @param {{fetch: Function, env: object, version: string, mailto?: string|null}} deps
 * @returns {import('../../ports/search-provider.js').SearchProvider[]}
 */
export function buildProviders(names, { fetch, env, version, mailto = null }) {
  return names.map((name) => {
    const factory = PROVIDER_FACTORIES[name];
    if (!factory) {
      throw new PhdudeError(
        'USAGE',
        `unknown provider ${name}`,
        `available: ${Object.keys(PROVIDER_FACTORIES).join(', ')}`,
      );
    }
    return factory({ fetch, env, version, mailto });
  });
}
