import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PhdudeError } from '../domain/errors.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas');
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: { 'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/ },
});
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const schema = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  ajv.addSchema(schema, schema.$id);
}
export const SCHEMA_TYPES = [
  'project',
  'artifact',
  'source',
  'claim',
  'evidence',
  'fact',
  'question',
  'hypothesis',
  'method',
  'result',
  'candidate',
  'dataset',
  'analysis',
  'table',
  'figure',
  'search',
  'decision',
  'manuscript',
  'section-report',
  'templates-registry',
  'author-profile',
  'pack',
  'skill',
  'event',
];
export const schemaName = (type) => `phdude.${type}`;
const validators = {};
export function validate(type, obj) {
  if (!SCHEMA_TYPES.includes(type))
    throw new PhdudeError('VALIDATION', `unknown schema type: ${type}`);
  validators[type] ??= ajv.getSchema(`phdude://${type}`);
  const ok = validators[type](obj);
  return ok
    ? { ok: true }
    : {
        ok: false,
        errors: validators[type].errors.map((e) => `${e.instancePath || '/'} ${e.message}`),
      };
}
export function assertValid(type, obj) {
  const r = validate(type, obj);
  if (!r.ok)
    throw new PhdudeError(
      'VALIDATION',
      `invalid ${type} ${obj?.id ?? ''}`.trim(),
      'fix the listed fields',
      r.errors,
    );
}

// A venue profile ships inside a pack rather than being an object PhDude stores, so like
// `results.json` it has a schema and no place in SCHEMA_TYPES. The loader turns a failure here
// into a typed error naming the file (adapters/packs/loader.js).
let profileValidator;
export function validateProfile(profile) {
  profileValidator ??= ajv.getSchema('phdude://profile');
  return profileValidator(profile)
    ? { ok: true }
    : {
        ok: false,
        errors: profileValidator.errors.map((e) => `${e.instancePath || '/'} ${e.message}`),
      };
}

// `results.json` is a file a researcher's script writes, not an entity PhDude stores, so it has
// a schema but no place in SCHEMA_TYPES. The shape is the published contract (docs/extending.md);
// what it cannot express - a summary that is blank once trimmed, a repeated key - is checked in
// domain/analysis.js, which reports each entry rather than failing the whole file.
let resultsJsonValidator;
export function validateResultsJson(json) {
  resultsJsonValidator ??= ajv.getSchema('phdude://results-json');
  return resultsJsonValidator(json)
    ? { ok: true }
    : {
        ok: false,
        errors: resultsJsonValidator.errors.map((e) => `${e.instancePath || '/'} ${e.message}`),
      };
}
