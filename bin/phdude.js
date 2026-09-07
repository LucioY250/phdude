#!/usr/bin/env node
import { createRequire } from 'node:module';
const { version } = createRequire(import.meta.url)('../package.json');
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(`phdude ${version}`);
  process.exit(0);
}
console.error('phdude: no command given (try --help)');
process.exit(1);
