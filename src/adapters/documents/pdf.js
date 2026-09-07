import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

const UNAVAILABLE_WARNING =
  'pdftotext not found: install poppler-utils (apt) / poppler (brew) to extract PDF text';

let availableCache;

async function checkAvailable() {
  if (availableCache !== undefined) return availableCache;
  try {
    await execFileAsync('pdftotext', ['-v']);
    availableCache = true;
  } catch (err) {
    availableCache = err.code !== 'ENOENT';
  }
  return availableCache;
}

export const pdfParser = {
  name: 'pdf',
  kinds: ['pdf'],
  available: checkAvailable,
  async parse(buffer, { path } = {}) {
    void path;
    if (!(await checkAvailable())) {
      return { text: '', sections: [], tables: [], meta: {}, warnings: [UNAVAILABLE_WARNING] };
    }

    let dir;
    try {
      dir = await mkdtemp(join(tmpdir(), 'phdude-pdf-'));
      const tmpFile = join(dir, 'input.pdf');
      await writeFile(tmpFile, buffer);
      const { stdout } = await execFileAsync('pdftotext', ['-layout', tmpFile, '-'], {
        maxBuffer: 64 * 1024 * 1024,
      });
      const pages = stdout.split('\f');
      if (pages.length > 1 && pages[pages.length - 1] === '') pages.pop();
      const sections = pages.map((p, i) => ({ title: `Page ${i + 1}`, text: p.trim() }));
      return { text: stdout, sections, tables: [], meta: { pages: pages.length }, warnings: [] };
    } catch (err) {
      return {
        text: '',
        sections: [],
        tables: [],
        meta: {},
        warnings: [`pdftotext failed: ${err.message}`],
      };
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  },
};
