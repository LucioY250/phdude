#!/usr/bin/env node
import { run } from '../src/adapters/cli/run.js';

process.exitCode = await run(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
  env: process.env,
});
