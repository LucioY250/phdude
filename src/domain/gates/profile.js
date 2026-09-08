// Venue profile validation (spec §3.4, gate 6): when the manuscript names a `target_profile`,
// the section has to be one the venue asks for and within its word limit. Where the venue puts it
// is a fact about the whole manuscript, which a gate reading one section cannot see, so
// `phdude profile check` reports the order. Without a target profile the gate reports nothing at
// all - a manuscript with no venue has no venue rules to break.
//
// The rules themselves live in `domain/profiles.js`, which `phdude profile check` also reads, so
// a section the gate lets through is one `profile check` lets through.

import { checkSection } from '../profiles.js';

const NAME = 'gate-profile';

export const profileGate = {
  name: NAME,

  /**
   * @param {string} text
   * @param {{venueProfile?: object|null, section?: string}} ctx
   *   `venueProfile` is a profile per `schemas/profile.json`
   * @returns {object[]} findings
   */
  run(text, ctx) {
    const profile = ctx?.venueProfile;
    if (!profile) return [];

    return checkSection(profile, { section: ctx.section, text }).map(
      ({ severity, message, hint }) => ({ gate: NAME, severity, line: 1, message, hint }),
    );
  },
};
