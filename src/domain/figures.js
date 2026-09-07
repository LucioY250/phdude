import { isAbsolute, normalize, sep } from 'node:path';
import { PhdudeError } from './errors.js';
import { parseId } from './ids.js';

const FIGURES_DIR = 'figures/';
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OUTPUT_FORMATS = ['svg', 'png', 'pdf'];
const INPUT_TYPES = ['result', 'dataset'];

// The generators the package ships. A figure names one as `phdude:<name>` rather than by path,
// because the path depends on where PhDude itself is installed and a workspace must not record
// that. Anything else a figure runs is the researcher's own script under `figures/`.
export const SHIPPED_GENERATORS = { 'phdude:bar-chart': 'bar-chart.mjs' };

/**
 * A figure's name becomes a filename, so it is a slug and nothing else.
 * @param {string} input
 * @returns {string}
 */
export function figureName(input) {
  const name = String(input ?? '').trim();
  if (!NAME_RE.test(name)) {
    throw new PhdudeError(
      'VALIDATION',
      `invalid figure name: ${input}`,
      'a figure name is lowercase words joined by "-", e.g. mean-weight',
    );
  }
  return name;
}

function insideDir(value, dir) {
  const text = String(value ?? '').trim();
  if (text === '' || isAbsolute(text)) return null;
  const rel = normalize(text).split(sep).join('/');
  const inside = rel.startsWith(dir) && rel.length > dir.length && !rel.split('/').includes('..');
  return inside ? rel : null;
}

/**
 * Which script a figure's generator is: one the package ships, or one the workspace holds under
 * `figures/`. Nothing else runs — a build is not a way to execute an arbitrary path.
 * @param {string} script
 * @returns {{shipped: string|null, path: string|null}}
 */
export function generatorScript(script) {
  const text = String(script ?? '').trim();
  if (text.startsWith('phdude:')) {
    const file = SHIPPED_GENERATORS[text];
    if (!file) {
      throw new PhdudeError(
        'VALIDATION',
        `unknown generator: ${text}`,
        `shipped generators: ${Object.keys(SHIPPED_GENERATORS).join(', ')}`,
      );
    }
    return { shipped: file, path: null };
  }
  const path = insideDir(text, FIGURES_DIR);
  if (path === null) {
    throw new PhdudeError(
      'VALIDATION',
      `generator script outside figures/: ${script}`,
      `a generator is figures/<script> or one of ${Object.keys(SHIPPED_GENERATORS).join(', ')}`,
    );
  }
  return { shipped: null, path };
}

function requireText(label, value) {
  const text = String(value ?? '').trim();
  if (text === '') {
    throw new PhdudeError('VALIDATION', `${label} must not be empty`, null);
  }
  return text;
}

function validateOutputs(outputs) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new PhdudeError(
      'VALIDATION',
      'a figure declares at least one output',
      `outputs: [{"path":"figures/out/<name>.svg","format":"svg"}]`,
    );
  }
  const seen = new Set();
  return outputs.map((output) => {
    const path = insideDir(output?.path, FIGURES_DIR);
    if (path === null) {
      throw new PhdudeError(
        'VALIDATION',
        `figure output outside figures/: ${output?.path}`,
        'a figure output looks like figures/out/<name>.svg',
      );
    }
    if (!OUTPUT_FORMATS.includes(output?.format)) {
      throw new PhdudeError(
        'VALIDATION',
        `unknown figure output format: ${output?.format}`,
        `formats are ${OUTPUT_FORMATS.join(', ')}`,
      );
    }
    if (seen.has(path)) {
      throw new PhdudeError('VALIDATION', `duplicate figure output: ${path}`, null);
    }
    seen.add(path);
    return { path, format: output.format };
  });
}

/**
 * The fields of a figure, checked and normalized. `alt` is required and non-empty (PRD §100): a
 * figure without a sentence saying what it shows is not a figure a thesis can publish, and
 * writing that sentence at build time — when the finding is already known — is too late.
 * @param {{name: string, caption: string, alt: string, generator: object, inputs?: string[],
 *   outputs: object[]}} fields
 * @returns {{name: string, caption: string, alt: string,
 *   generator: {runtime: string, script: string, args: string[]},
 *   inputs: string[], outputs: {path: string, format: string}[]}}
 */
export function validateFigure(fields) {
  const alt = String(fields?.alt ?? '').trim();
  if (alt === '') {
    throw new PhdudeError(
      'VALIDATION',
      'a figure needs alt text',
      'alt states the finding the figure shows, in one sentence a reader who cannot see it can use',
    );
  }

  const generator = fields?.generator ?? {};
  const runtime = requireText('generator.runtime', generator.runtime);
  const script = requireText('generator.script', generator.script);
  generatorScript(script);
  const args = generator.args ?? [];
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    throw new PhdudeError('VALIDATION', 'generator.args must be a list of strings', null);
  }

  const inputs = fields?.inputs ?? [];
  if (!Array.isArray(inputs)) {
    throw new PhdudeError('VALIDATION', 'inputs must be a list of ids', null);
  }
  for (const id of inputs) {
    if (!INPUT_TYPES.includes(parseId(id)?.type)) {
      throw new PhdudeError(
        'VALIDATION',
        `not a result or dataset id: ${id}`,
        'a figure is built from RESULT or DATASET ids',
      );
    }
  }

  return {
    name: figureName(fields?.name),
    caption: requireText('caption', fields?.caption),
    alt,
    generator: { runtime, script, args: [...args] },
    inputs: [...inputs],
    outputs: validateOutputs(fields?.outputs),
  };
}

function lastSuccessfulRun(figure) {
  const runs = Array.isArray(figure?.runs) ? figure.runs : [];
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i]?.exit === 0) return runs[i];
  }
  return null;
}

/**
 * Pure: what is wrong with one figure. Freshness is the last successful run's input hashes
 * against the ones the workspace holds now, so editing a dataset makes every figure built from
 * it stale without anything having to watch the file. Missing alt text is reported alongside,
 * but it is an accessibility defect rather than a staleness one, so it does not change the
 * status a rebuild would fix.
 * @param {object} figure
 * @param {{inputHashes?: Record<string, string|null>, present?: Record<string, boolean>}} state
 *   `inputHashes`: the current hash of every input, `null` when the workspace no longer has it.
 *   `present`: whether each declared output path exists on disk.
 * @returns {{id: string, name: string, status: 'up-to-date'|'stale'|'never-run'|'missing-output',
 *   findings: object[]}}
 */
export function staleness(figure, { inputHashes = {}, present = {} } = {}) {
  const findings = [];
  if (String(figure?.alt ?? '').trim() === '') findings.push({ kind: 'missing-alt' });

  const run = lastSuccessfulRun(figure);
  if (run === null) {
    findings.push({ kind: 'never-run' });
    return { id: figure.id, name: figure.name, status: 'never-run', findings };
  }

  for (const output of figure.outputs ?? []) {
    if (present[output.path] !== true) findings.push({ kind: 'missing-output', path: output.path });
  }

  for (const input of figure.inputs ?? []) {
    const current = inputHashes[input] ?? null;
    const recorded = run.input_hashes?.[input] ?? null;
    if (current === null) {
      findings.push({ kind: 'missing-input', input });
    } else if (current !== recorded) {
      findings.push({ kind: 'stale-input', input, recorded, current });
    }
  }

  const status = findings.some((f) => f.kind === 'missing-output')
    ? 'missing-output'
    : findings.some((f) => f.kind === 'stale-input' || f.kind === 'missing-input')
      ? 'stale'
      : 'up-to-date';
  return { id: figure.id, name: figure.name, status, findings };
}
