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
  'search',
  'decision',
  'manuscript',
  'section-report',
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
