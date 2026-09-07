import { PhdudeError } from '../domain/errors.js';
import { parseSectionFile } from '../domain/manuscript.js';
import { voiceGate } from '../domain/gates/voice.js';
import { lint } from '../domain/prose-lint.js';
import { markerCounts, markerInventory } from '../domain/gates/markers.js';
import { findSection, gateContext, loadManuscript, recordSection } from './manuscript.js';
import { assertUpToDate } from './guard.js';

// `phdude deslop <section>` (spec §3.5) is the revision half of the writing pipeline. Without a
// file it reports what the section's prose is doing and what a revision may and may not change;
// with one it runs every gate, `gate-meaning` included, and records the revision only when the
// meaning survived it. The agent revises the text; the CLI is still the only writer.

// What a revision may not change. Printed with the observations so the agent has the rule in
// front of it rather than in a skill it may not have loaded.
export const REVISION_CONTRACT = {
  change: [
    'Rewrite the sentences the observations name, one at a time.',
    'Vary sentence length and openings where the report says they repeat.',
    'Delete filler; replace an intensifier with the number or the citation behind it.',
  ],
  preserve: [
    'Every <!-- claim: CLAIM-… --> marker, on the paragraph that asserts it.',
    'Every [@key] citation, including the ones inside a bracketed group.',
    'Every number, exactly as written.',
    'Every negation: dropping a "not" reverses the finding.',
    'The hedge each claim state requires: "may reduce" and "reduces" are different claims.',
  ],
};

async function sectionBody(store, entry) {
  if (entry.status === 'planned') {
    throw new PhdudeError(
      'USAGE',
      `section ${entry.id} has nothing written yet`,
      `phdude write ${entry.id}, then phdude manuscript submit ${entry.id} --file <draft.md>`,
      null,
    );
  }
  const text = await store.readSection(entry.file);
  if (text === null) {
    throw new PhdudeError(
      'VALIDATION',
      `section ${entry.id} is ${entry.status} but ${entry.file} is missing`,
      'restore the file from git, or submit the section again',
      null,
    );
  }
  return parseSectionFile(text).body;
}

/**
 * @param {{store: object, clock: () => string, actor: object,
 *   readText: (path: string) => Promise<string|null>,
 *   loadProfile?: (name: string) => Promise<object|null>}} deps
 * @param {{section: string, file?: string, allowAdditions?: boolean, gates?: object[]}} input
 * @returns {Promise<object>} the observations and the contract, or the recorded revision
 */
export async function deslop(
  { store, clock, actor, readText, loadProfile },
  { section, file, allowAdditions = false, gates } = {},
) {
  assertUpToDate(await store.readProject());

  const manuscript = await loadManuscript(store);
  const entry = findSection(manuscript, section);

  if (entry.status === 'approved') {
    throw new PhdudeError(
      'POLICY',
      `section ${entry.id} is approved; approved text is not revised in place`,
      `phdude manuscript reopen ${entry.id}, then deslop it`,
      null,
    );
  }

  const current = await sectionBody(store, entry);

  if (!file) {
    const ctx = await gateContext({ store, loadProfile }, { manuscript, entry });
    const report = lint(current, {
      lang: ctx.lang,
      mode: ctx.mode === 'ruthless' ? 'ruthless' : 'full',
      markers: markerCounts(markerInventory(current, ctx)),
      profile: ctx.voiceProfile,
    });
    return {
      section: entry,
      revised: false,
      observations: report.observations,
      voice: voiceGate.run(current, ctx).findings,
      scores: report.scores,
      aggregate: report.aggregate,
      contract: REVISION_CONTRACT,
      body: current,
    };
  }

  const revised = await readText(file);
  if (revised === null) {
    throw new PhdudeError('USAGE', `cannot read ${file}`, 'pass the path to the revision', null);
  }

  const result = await recordSection(
    { store, clock, actor, loadProfile },
    {
      manuscript,
      entry,
      body: parseSectionFile(revised).body,
      target: 'revised',
      summary: `deslop ${entry.id} (revised)`,
      revisionOf: current,
      allowAdditions,
      gates,
    },
  );

  return { ...result, revised: true, contract: REVISION_CONTRACT };
}
