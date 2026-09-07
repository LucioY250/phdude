// Author voice check (spec §3.4, gate 4). The comparison it will make - the draft's descriptive
// statistics against the active profile's `learned` fields, plus the profile's preserve and
// avoid lists - needs the author profiles that arrive with `phdude authors`, so v0.4 registers
// the gate and reports nothing. It is in the pipeline from the start so that the report shape,
// the gate list and every surface that names a gate are already right when it starts speaking.

const NAME = 'gate-voice';

export const voiceGate = {
  name: NAME,

  // TODO(T4b): compare stats(text, lang) with ctx.voiceProfile.learned within the policy's
  // tolerances, warn on terminology.avoid, and report missing preserved terminology as info.
  run() {
    return [];
  },
};
