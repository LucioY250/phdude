// Venue profile validation (spec §3.4, gate 6): when the manuscript names a `target_profile`,
// the section has to be one the venue asks for, in the place the venue puts it, and within its
// word limit. v0.4 ships one generous profile (`generic-thesis`); v0.6 fills in real venues.
// Without a target profile the gate reports nothing at all - a manuscript with no venue has no
// venue rules to break.

import { words } from '../textstats.js';

const NAME = 'gate-profile';

function finding(severity, message, hint) {
  return { gate: NAME, severity, line: 1, message, hint };
}

export const profileGate = {
  name: NAME,

  /**
   * @param {string} text
   * @param {{venueProfile?: object|null, section?: string, sectionOrder?: number}} ctx
   *   `venueProfile` is `{ name, sections: [{ id, max_words? }], max_words? }`
   * @returns {object[]} findings
   */
  run(text, ctx) {
    const profile = ctx?.venueProfile;
    if (!profile) return [];

    const sections = profile.sections ?? [];
    const index = sections.findIndex((entry) => entry.id === ctx.section);
    const findings = [];

    if (index === -1) {
      findings.push(
        finding(
          'warn',
          `${profile.name} does not list a "${ctx.section}" section`,
          `${profile.name} expects: ${sections.map((s) => s.id).join(', ') || '(no sections)'}`,
        ),
      );
    } else if (typeof ctx.sectionOrder === 'number' && ctx.sectionOrder !== index + 1) {
      findings.push(
        finding(
          'warn',
          `${profile.name} puts ${ctx.section} at position ${index + 1}; the manuscript has it at ${ctx.sectionOrder}`,
          'reorder the manuscript sections, or drop target_profile from manuscript.yaml',
        ),
      );
    }

    const limit = sections[index]?.max_words ?? profile.max_words ?? null;
    const count = words(text).length;
    if (limit !== null && count > limit) {
      findings.push(
        finding(
          'block',
          `${count} words exceeds the ${limit}-word limit ${profile.name} sets for ${ctx.section}`,
          'cut the section, raise the limit in the venue profile, or drop target_profile',
        ),
      );
    }

    return findings;
  },
};
