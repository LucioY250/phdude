import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function writeFileAtomic(absPath, data) {
  await mkdir(dirname(absPath), { recursive: true });
  const tmp = join(
    dirname(absPath),
    `.${basename(absPath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`,
  );
  await writeFile(tmp, data);
  await rename(tmp, absPath);
}
