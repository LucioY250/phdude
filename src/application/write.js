import { join } from 'node:path';
import { assignBibkeys } from '../domain/bibkey.js';
import { DEFAULT_BUDGET_CHARS, assembleContext } from '../domain/context-budget.js';
import { PhdudeError } from '../domain/errors.js';
import { SECTION_ID_RE, voiceIdFor } from '../domain/manuscript.js';
import { loadSnapshot } from './snapshot.js';

// `phdude write` (spec §3.3) assembles what an agent needs to draft one section and hands it
// the contract it has to write to. It writes nothing but cache: no section file, no manuscript
// entry, no event. The prose is the agent's, the record is `manuscript submit`'s.

const WRITING_POLICY = join('.phdude', 'writing-policy.yaml');

// What the agent owes back. Printed with the context path, because a context without a contract
// is an invitation to write whatever reads well.
export const DRAFT_CONTRACT = [
  'Write Markdown for this section only - no title page, no other section, no front matter.',
  'Cite as [@bibkey], using only the keys the context lists. A key that resolves to nothing blocks the submit.',
  'Put one <!-- claim: CLAIM-… --> in every paragraph that asserts a claim.',
  'Mark every numeral that comes from the workspace with <!-- fact: FACT-… --> or <!-- result: RESULT-… -->.',
  'Match the verb to the claim state: the context carries the table.',
  'Add no source, number or finding the context does not carry. If you need one, say so and stop.',
];

function contractFor(section) {
  return [
    ...DRAFT_CONTRACT,
    `Submit it with: phdude manuscript submit ${section} --file <draft.md>`,
  ];
}

function parseBudget(budget) {
  if (budget === undefined || budget === null || budget === '') return DEFAULT_BUDGET_CHARS;
  const value = Number(budget);
  if (!Number.isInteger(value) || value <= 0) {
    throw new PhdudeError(
      'VALIDATION',
      `invalid budget: ${budget}`,
      '--budget takes a positive number of characters',
    );
  }
  return value;
}

/**
 * @param {{store: object, clock?: () => string}} deps
 * @param {{section: string, voice?: string, budget?: string|number}} input
 * @returns {Promise<{section: object, path: string, markdown: string, included: object[],
 *   truncated: object[], voice: {id: string, found: boolean}, budget: number,
 *   contract: string[]}>}
 */
export async function write({ store, clock }, { section, voice, budget } = {}) {
  const snapshot = await loadSnapshot(store, clock);

  if (snapshot.manuscript === null) {
    throw new PhdudeError(
      'USAGE',
      'this workspace has no manuscript',
      'phdude manuscript init',
      null,
    );
  }
  const entry = snapshot.manuscript.sections.find((s) => s.id === section);
  if (!entry) {
    throw new PhdudeError(
      'USAGE',
      `unknown section: ${section ?? '(none)'}`,
      `sections: ${snapshot.manuscript.sections.map((s) => s.id).join(', ')}`,
      null,
    );
  }

  const voiceId = voiceIdFor(snapshot.manuscript, voice);
  if (!SECTION_ID_RE.test(voiceId)) {
    throw new PhdudeError(
      'VALIDATION',
      `invalid voice: ${voiceId}`,
      '--voice takes an author profile id (lowercase words joined by "-")',
      null,
    );
  }
  // The profile is read where `phdude authors` writes it. A workspace that has recorded no
  // voice yet is not an error: the context says so in as many words and the agent writes
  // plainly, which is better than writing in an invented voice.
  const profile = await store.readYaml(join('authors', `${voiceId}.yaml`));
  const policy = await store.readYaml(WRITING_POLICY);
  const budgetChars = parseBudget(budget);

  const context = assembleContext(snapshot, entry.id, {
    profile,
    policy,
    budgetChars,
    bibkeys: assignBibkeys(snapshot.sources ?? []),
  });

  const path = await store.writeWritingContext(entry.id, context.markdown);

  return {
    section: entry,
    path,
    markdown: context.markdown,
    included: context.included,
    truncated: context.truncated,
    voice: { id: voiceId, found: profile !== null },
    budget: budgetChars,
    contract: contractFor(entry.id),
  };
}
