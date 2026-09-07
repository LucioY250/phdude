import { join } from 'node:path';
import { driftNote, parseSectionFile, sectionDrift } from '../domain/manuscript.js';
import {
  executionAllowed,
  executionRuntimes,
  executionTimeoutMs,
  networkAllowed,
  providerNames,
} from '../domain/policy.js';
import { CURRENT_WORKSPACE_VERSION, workspaceVersionOf } from '../domain/versioning.js';
import { migrationWarning } from './guard.js';
import { listSkills } from './skills.js';

const POLICY_PATH = join('.phdude', 'research-policy.yaml');

// v0.1 stamps every canonical object at schema version 1 (design spec S5); the migration
// system that makes this per-type is v0.2 (PRD S112).
const SCHEMA_VERSION = 1;

/**
 * Reports what the runtime can and cannot do here. Diagnostic only: never writes.
 * @param {{store: object, git: object, parsers: object[], renderers?: object[],
 *   loadPacks: () => Promise<object[]>, schemaTypes: string[], node: string,
 *   discoverSkills: (roots: object[]) => Promise<object[]>, skillsDir: string}} deps
 * @returns {Promise<{node: string, pdftotext: boolean, git: boolean, workspace: boolean,
 *   workspaceVersion: number|null, workspaceVersionCurrent: number, parsers: object,
 *   renderers: object[], policyError: string|null, network: boolean|null, providers: string[],
 *   execution: object|null, schemaVersions: object, cacheEntries: number, packsAvailable: string[],
 *   skills: object[], manuscript: object|null, warnings: string[]}>}
 */
export async function doctor({
  store,
  git,
  parsers,
  renderers = [],
  loadPacks,
  schemaTypes,
  node,
  discoverSkills,
  skillsDir,
}) {
  const warnings = [];

  const workspace = await store.exists('phdude.yaml');
  if (!workspace) warnings.push('phdude.yaml not found; run phdude init to create a workspace');

  // doctor is the command a researcher runs when something is off, so a phdude.yaml it cannot
  // read is a warning here, never the exception it is everywhere else.
  let workspaceVersion = null;
  if (workspace) {
    try {
      const project = await store.readProject();
      workspaceVersion = workspaceVersionOf(project);
      const outdated = migrationWarning(project);
      if (outdated) warnings.push(outdated);
    } catch (err) {
      warnings.push(`phdude.yaml could not be read: ${err.message}`);
    }
  }

  const gitAvailable = await git.isAvailable();
  if (!gitAvailable) {
    warnings.push('git is not installed; workspace history and collaboration are unavailable');
  }

  const parserAvailability = {};
  for (const parser of parsers) {
    parserAvailability[parser.name] = await parser.available();
  }
  const pdftotext = parserAvailability.pdf === true;
  if (!pdftotext) {
    warnings.push('pdftotext is not installed; PDF text extraction is unavailable');
  }

  // Which deliverables this machine can actually produce. The built-in Markdown renderer is
  // always one of them; the rest name the tool that is missing rather than failing a build later.
  const rendererAvailability = [];
  for (const renderer of renderers) {
    try {
      const availability = await renderer.available();
      rendererAvailability.push({
        name: renderer.name,
        formats: renderer.formats,
        available: availability.ok === true,
        version: availability.version ?? null,
        hint: availability.hint ?? null,
      });
      if (!availability.ok) {
        warnings.push(
          `${renderer.name} is not available: ${renderer.formats.join(', ')} cannot be built (${availability.hint})`,
        );
      }
    } catch (err) {
      rendererAvailability.push({
        name: renderer.name,
        formats: renderer.formats,
        available: false,
        version: null,
        hint: null,
      });
      warnings.push(`${renderer.name} could not be probed: ${err.message}`);
    }
  }

  // Reported, never exercised: doctor says what the network policy allows without making a
  // single call. A policy it cannot read is reported as unreadable rather than answered with the
  // built-in defaults - "what does this workspace's policy say" is the question doctor exists
  // to answer, so presenting a fiction here is worse than presenting nothing.
  let policy = null;
  let policyError = null;
  try {
    policy = await store.readYaml(POLICY_PATH);
  } catch (err) {
    policyError = err.message;
    warnings.push(`research-policy.yaml could not be read: ${err.message}`);
  }

  let packsAvailable = [];
  try {
    packsAvailable = (await loadPacks()).map((p) => p.name);
  } catch (err) {
    warnings.push(`packs could not be loaded: ${err.message}`);
  }

  // The manuscript is the one v0.4 subsystem doctor could not see: what is written, what has a
  // report, and which sections a researcher edited outside PhDude since the last submit.
  let manuscript = null;
  try {
    manuscript = await manuscriptHealth(store, warnings);
  } catch (err) {
    warnings.push(`the manuscript could not be read: ${err.message}`);
  }

  let skills = [];
  try {
    const listed = await listSkills({ store, loadPacks, discoverSkills, skillsDir });
    skills = listed.skills;
    // One bad skill file, or one skill the workspace policy has not cleared for network access,
    // is a line in this report - never the reason the report is empty.
    warnings.push(...listed.warnings);
  } catch (err) {
    warnings.push(`skills could not be loaded: ${err.message}`);
  }

  return {
    node,
    pdftotext,
    git: gitAvailable,
    workspace,
    workspaceVersion,
    workspaceVersionCurrent: CURRENT_WORKSPACE_VERSION,
    parsers: parserAvailability,
    renderers: rendererAvailability,
    policyError,
    network: policyError === null ? networkAllowed(policy, {}) : null,
    providers: policyError === null ? providerNames(policy) : [],
    // What the workspace will and will not run, next to what it will and will not fetch. Both
    // are closed by default and both are the kind of thing a researcher checks before asking
    // why `analyze run` refused (spec §3.1).
    execution:
      policyError === null
        ? {
            enabled: executionAllowed(policy, {}),
            runtimes: Object.keys(executionRuntimes(policy)).sort((a, b) => a.localeCompare(b)),
            timeoutSeconds: Math.round(executionTimeoutMs(policy) / 1000),
          }
        : null,
    schemaVersions: Object.fromEntries(schemaTypes.map((t) => [t, SCHEMA_VERSION])),
    cacheEntries: (await store.listCacheEntries()).length,
    packsAvailable,
    skills,
    manuscript,
    warnings,
  };
}

async function manuscriptHealth(store, warnings) {
  const doc = await store.readManuscript();
  if (!doc) return null;

  const counts = { planned: 0, draft: 0, revised: 0, approved: 0 };
  const drifted = [];
  for (const entry of doc.sections ?? []) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    if (entry.status === 'planned') continue;
    const text = await store.readSection(entry.file);
    const body = text === null ? null : parseSectionFile(text).body;
    if (sectionDrift(entry, body).drifted) drifted.push(entry.id);
  }
  for (const id of drifted) warnings.push(driftNote(id));

  return {
    counts,
    reports: (await store.listReports()).map((report) => report.section),
    drifted,
  };
}
