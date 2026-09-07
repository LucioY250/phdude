import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' });
writeFileSync(process.argv[2], String(child.pid));
setTimeout(() => {}, 60_000);
