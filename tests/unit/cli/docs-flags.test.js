import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMAND_OPTIONS, optionsFor } from '../../../src/adapters/cli/args.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI_DOC = readFileSync(join(REPO_ROOT, 'docs', 'cli.md'), 'utf8');

// Every `### \`phdude <command> …\`` section of docs/cli.md, mapped to the flags its text
// mentions. Strict parsing means a flag documented but missing from the option table exits 1
// on the user; this reads the reference the same way a researcher does, so the two cannot
// drift apart in silence.
function documentedFlags() {
  const sections = new Map();
  let command = null;
  for (const line of CLI_DOC.split('\n')) {
    const heading = /^### `phdude ([a-z-]+)/.exec(line);
    if (heading) {
      command = heading[1];
      sections.set(command, sections.get(command) ?? new Set());
    } else if (line.startsWith('## ')) {
      command = null;
    }
    if (!command) continue;
    for (const match of line.matchAll(/--[a-z][a-z0-9-]*/g)) {
      sections.get(command).add(match[0]);
    }
  }
  return sections;
}

test('docs/cli.md documents a command for every command that takes options', () => {
  const documented = [...documentedFlags().keys()];
  for (const command of Object.keys(COMMAND_OPTIONS)) {
    if (command === 'help') continue; // documented under `phdude help`, which takes no options
    assert.ok(documented.includes(command), `docs/cli.md has no section for ${command}`);
  }
});

test('every flag documented in docs/cli.md is accepted by the parser', () => {
  for (const [command, flags] of documentedFlags()) {
    const allowed = optionsFor(command);
    for (const flag of flags) {
      assert.ok(
        Object.hasOwn(allowed, flag.slice(2)),
        `docs/cli.md documents ${flag} for ${command}, but the option table rejects it`,
      );
    }
  }
});
