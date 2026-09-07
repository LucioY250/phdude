// Author voice check (spec §3.4, gate 4). The draft's descriptive statistics are compared with
// the active profile's `learned` fields, the profile's `terminology.avoid` list is checked
// against the prose, and terminology the profile asks to preserve is reported when the claims
// this section asserts use it and the draft does not.
//
// Voice never blocks, `ruthless` mode included: a deviation from a learned baseline is an
// observation about how a researcher usually writes, not a defect in what this draft says, and
// the profile itself is inferred from a handful of samples. A gate that stopped a submit on it
// would make PhDude the author.

import { findPhrases, lineAt, stats } from '../textstats.js';
import { voiceDeviation, voiceScore } from '../voice.js';
import { markerInventory } from './markers.js';

const NAME = 'gate-voice';

const HINTS = {
  'sentence-length': 'not a defect: check whether the section reads like the rest of the thesis',
  'sentence-length-sd': 'vary the sentence lengths, or accept that this section is more uniform',
  'opening-diversity': 'open sentences the way the samples do, or accept the difference',
  'transition-rate': 'let the argument carry the connection, as the learned samples do',
  'first-person-rate': 'match the profile\'s "we"/"I" habit, or update the profile',
  'avoid-word': "replace the word, or drop it from the profile's terminology.avoid",
};

// Terminology the profile preserves, used by a claim this draft asserts but absent from the
// draft itself: the researcher's own word for the thing, dropped somewhere between the claim
// and the prose. Reported as `info`, because a paraphrase can be deliberate.
function missingPreservedTerms(text, profile, ctx) {
  const preserve = profile?.terminology?.preserve ?? [];
  if (preserve.length === 0) return [];

  const statements = markerInventory(text, ctx)
    .claims.map((claim) => ctx?.claimsById?.get(claim.id)?.statement)
    .filter((statement) => typeof statement === 'string');
  if (statements.length === 0) return [];

  const claimText = statements.join('\n');
  const byLower = new Map(preserve.map((term) => [String(term).toLowerCase(), term]));
  const lowered = [...byLower.keys()];
  const inDraft = new Set(findPhrases(text, lowered).map((hit) => hit.phrase));

  return findPhrases(claimText, lowered)
    .filter((hit) => !inDraft.has(hit.phrase))
    .filter((hit, i, all) => all.findIndex((other) => other.phrase === hit.phrase) === i)
    .map((hit) => ({
      gate: NAME,
      severity: 'info',
      line: 1,
      message: `the claims this section asserts use "${byLower.get(hit.phrase)}", which the profile preserves, and the draft does not`,
      hint: "use the researcher's own term, or drop it from the profile's terminology.preserve",
    }));
}

export const voiceGate = {
  name: NAME,

  /**
   * @param {string} text - the section body
   * @param {object} ctx - the gate context; `voiceProfile` is the active author profile
   * @returns {{findings: object[], scores: {authorVoice: number|null}}} nothing at all, and a
   *   null score, when the workspace has recorded no voice
   */
  run(text, ctx) {
    const profile = ctx?.voiceProfile ?? null;
    if (!profile) return { findings: [], scores: { authorVoice: null } };

    const source = String(text ?? '');
    const measured = stats(source, ctx?.lang);
    const findings = voiceDeviation({ ...measured, text: source }, profile).map((finding) => ({
      gate: NAME,
      severity: 'warn',
      line: typeof finding.index === 'number' ? lineAt(source, finding.index) : 1,
      message: finding.why,
      hint: HINTS[finding.kind] ?? 'compare the draft with the profile, then decide',
    }));

    return {
      findings: [...findings, ...missingPreservedTerms(source, profile, ctx ?? {})],
      scores: { authorVoice: voiceScore(measured, profile) },
    };
  },
};
