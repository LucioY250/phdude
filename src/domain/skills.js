// External skills (spec §3.5): what a workspace is allowed to install from outside itself, and
// what it records once it has. Pure - the bytes are read, cloned and copied by the application
// and its adapters, and everything decided about an external skill is decided here.

import { PhdudeError } from './errors.js';
import { sha256 } from './hash.js';

export const LOCK_SCHEMA = 'phdude.skills-lock';

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// PRD §30c makes detector evasion a prohibited goal, so PhDude will not install a skill that
// says it is for one. Matched against the purpose strings a skill declares about itself - its
// front matter `name` and `description` - and not the whole file: the shipped `academic-prose`
// skill states the prohibition in its body, and a fork of it must stay installable.
const DETECTOR_PURPOSE = /detect(or|ion)\s+(evasion|bypass)|humaniz|humanity score/i;

const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;
const HTTPS = /^https:\/\//i;
const SCP_LIKE = /^[^\s/]+@[^\s/]+:/;

/**
 * @param {(string|null|undefined)[]} strings - the purpose strings the skill declares
 * @returns {string|null} the matched phrase, or null when none of them names a detector
 */
export function detectorPurpose(strings) {
  for (const value of strings) {
    const match = DETECTOR_PURPOSE.exec(String(value ?? ''));
    if (match) return match[0];
  }
  return null;
}

/**
 * @param {string} name
 * @param {(string|null|undefined)[]} strings
 * @throws {PhdudeError} POLICY, when a purpose string names detector evasion or a humanizer
 */
export function assertNoDetectorPurpose(name, strings) {
  const match = detectorPurpose(strings);
  if (match === null) return;
  throw new PhdudeError(
    'POLICY',
    `skill ${name} describes itself as "${match}"`,
    'see PRD §30c: PhDude neither measures nor evades AI-detector scores',
  );
}

/**
 * Where a skill is being installed from. Only two answers are supported: a directory on this
 * machine, and a repository cloned over https. Every other transport carries credentials or an
 * unauthenticated channel, so it is refused here rather than handed to git.
 * @param {string} source
 * @returns {{kind: 'git', url: string}|{kind: 'path', path: string}}
 */
export function classifySkillSource(source) {
  const value = String(source ?? '').trim();
  if (value === '') {
    throw new PhdudeError(
      'USAGE',
      'skills install needs a directory or an https git URL',
      'phdude skills install <path|https://…>',
    );
  }

  if (URL_LIKE.test(value)) {
    if (!HTTPS.test(value)) {
      throw new PhdudeError(
        'VALIDATION',
        `unsupported skill source: ${value}`,
        'a remote skill is cloned over https only',
      );
    }
    const url = new URL(value);
    if (url.username !== '' || url.password !== '') {
      throw new PhdudeError(
        'VALIDATION',
        'a skill URL must not carry credentials',
        'clone the repository yourself and install from the directory',
      );
    }
    return { kind: 'git', url: value };
  }

  if (SCP_LIKE.test(value)) {
    throw new PhdudeError(
      'VALIDATION',
      `unsupported skill source: ${value}`,
      'a remote skill is cloned over https only',
    );
  }

  return { kind: 'path', path: value };
}

/**
 * The identity of an installed skill: one sha256 over the tree's sorted `<path> <sha256>` lines,
 * so an edited byte and a renamed file both move it, and the order the files were read in
 * never does.
 * @param {{path: string, bytes: Uint8Array}[]} files
 * @returns {string}
 */
export function skillTreeHash(files) {
  const manifest = files
    .map((file) => `${file.path} ${sha256(file.bytes)}`)
    .sort()
    .join('\n');
  return sha256(manifest);
}

/**
 * @returns {{schema: string, version: number, skills: object[]}}
 */
export function emptyLock() {
  return { schema: LOCK_SCHEMA, version: 1, skills: [] };
}

/**
 * @param {object|null} lock
 * @param {string} name
 * @returns {object|null}
 */
export function findLocked(lock, name) {
  return (lock?.skills ?? []).find((entry) => entry.name === name) ?? null;
}

/**
 * @param {object|null} lock
 * @param {{name: string, source: string, hash: string, installed_at: string}} entry
 * @returns {object} a new lock, its entries sorted by name
 */
export function upsertLocked(lock, entry) {
  const others = (lock?.skills ?? []).filter((locked) => locked.name !== entry.name);
  return {
    ...emptyLock(),
    ...lock,
    skills: [...others, entry].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  };
}

/**
 * @param {object|null} lock
 * @param {string} name
 * @returns {object} a new lock
 */
export function removeLocked(lock, name) {
  return {
    ...emptyLock(),
    ...lock,
    skills: (lock?.skills ?? []).filter((entry) => entry.name !== name),
  };
}
