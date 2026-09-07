import { PhdudeError } from '../domain/errors.js';
import { GATES, runGates } from '../domain/gates/index.js';
import { markerCounts, markerInventory } from '../domain/gates/markers.js';
import { parseSectionFile, sectionDrift, sectionHash } from '../domain/manuscript.js';
import { lint } from '../domain/prose-lint.js';
import { findSection, gateContext, loadManuscript, numericScores } from './manuscript.js';
import { assertUpToDate } from './guard.js';

// The Academic Prose Quality report of PRD §39.1, over a plain text file. `phdude prose
// <section>` (v0.4 Task 4) will run the same lint over a manuscript section with its claims,
// evidence and voice profile attached; this text-only mode is what the `academic-prose` skill's
// `scripts/prose-lint.mjs` shells out to, and it needs no workspace at all.
//
// It reports; it never blocks. Exit stays 0 whatever the observations say.

const DEFAULT_LANG = 'en';

/**
 * @param {{fs: {read: (path: string) => Promise<Buffer>}}} deps
 * @param {string} path - the file to lint, already resolved against the caller's cwd
 * @param {{lang?: string}} [options]
 * @returns {Promise<object>} the lint report with the file it describes
 */
export async function proseFile({ fs }, path, { lang } = {}) {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new PhdudeError(
      'USAGE',
      'prose needs a file to read',
      'phdude prose --file <path> [--lang en|es]',
    );
  }

  let text;
  try {
    text = (await fs.read(path)).toString('utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new PhdudeError('USAGE', `not found: ${path}`, 'pass the path to a text file');
    }
    if (err.code === 'EISDIR') {
      throw new PhdudeError('USAGE', `not a file: ${path}`, 'pass one file, not a directory');
    }
    throw err;
  }

  return { file: path, ...lint(text, { lang: lang ?? DEFAULT_LANG }) };
}

/**
 * The same report over a manuscript section, with the evidence graph behind it: the markers the
 * prose carries are resolved against the workspace, so Evidence Alignment and Epistemic
 * Precision are real numbers rather than `n/a`. The scores are stored in the section's report -
 * a derived file, like `references.bib`, which is why this records no event.
 *
 * The whole report is recomputed, never merged onto the last one: the hash, the timestamp, the
 * gate rows and the counts describe the body this run measured, so a number in
 * `manuscript/reports/` is never stamped with a hash that does not describe it. Every gate runs
 * to fill those rows, and nothing is written to the section or the manuscript - `prose` reports
 * on prose, it never records it.
 *
 * @param {{store: object, clock: () => string,
 *   loadProfile?: (name: string) => Promise<object|null>}} deps
 * @param {string} section
 * @returns {Promise<object>} the lint report, the section it describes, whether the section has
 *   drifted from its record, and the report this run stored
 */
export async function proseSection({ store, clock, loadProfile }, section) {
  assertUpToDate(await store.readProject());

  const manuscript = await loadManuscript(store);
  const entry = findSection(manuscript, section);

  if (entry.status === 'planned') {
    throw new PhdudeError(
      'USAGE',
      `section ${entry.id} has nothing written yet`,
      `phdude write ${entry.id}, then phdude manuscript submit ${entry.id} --file <draft.md>`,
    );
  }

  const text = await store.readSection(entry.file);
  if (text === null) {
    throw new PhdudeError(
      'VALIDATION',
      `section ${entry.id} is ${entry.status} but ${entry.file} is missing`,
      'restore the file from git, or submit the section again',
    );
  }

  const { body } = parseSectionFile(text);
  const ctx = await gateContext({ store, loadProfile }, { manuscript, entry });
  const report = lint(body, {
    lang: ctx.lang,
    mode: ctx.mode === 'ruthless' ? 'ruthless' : 'full',
    markers: markerCounts(markerInventory(body, ctx)),
    profile: ctx.voiceProfile,
  });
  const run = runGates(body, ctx, { mode: ctx.mode, gates: Object.values(GATES) });
  // The Author Voice number is a comparison against the profile, so the report shows the
  // comparisons behind it rather than leaving the section's recorded warnings off the screen.
  const voice = run.findings.filter((finding) => finding.gate === 'gate-voice');

  const stored = {
    schema: 'phdude.section-report',
    version: 1,
    section: entry.id,
    hash: sectionHash(body),
    at: clock(),
    gates: run.gates,
    scores: numericScores(run.scores),
    warnings: run.findings.filter((finding) => finding.severity === 'warn').length,
    blocks: run.findings.filter((finding) => finding.severity === 'block').length,
  };
  await store.writeReport(entry.id, stored);

  return {
    section: entry,
    file: entry.file,
    ...report,
    voice,
    drift: sectionDrift(entry, body),
    stored,
  };
}
