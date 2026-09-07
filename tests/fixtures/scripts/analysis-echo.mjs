// The analysis a test declares: it reads the CSVs it was pointed at, derives two findings from
// them, and writes the results.json contract. Deterministic - the same bytes in, the same file
// out - so a test can assert on ids. The flags after --out exist to produce the failures the
// application has to survive; a real analysis needs none of them.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const inputs = [];
let out = null;
let fail = null;
const flags = new Set();

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--input') inputs.push(args[++i]);
  else if (args[i] === '--out') out = args[++i];
  else if (args[i] === '--fail') fail = Number(args[++i]);
  else flags.add(args[i]);
}

if (flags.has('--hang')) {
  setInterval(() => {}, 1000);
} else {
  const workspace = process.env.PHDUDE_WORKSPACE;
  const analysis = process.env.PHDUDE_ANALYSIS;

  if (fail !== null) {
    process.stderr.write(`no such column: age\nread ${inputs.join(', ')}\n`);
    process.exit(fail);
  }

  const ages = [];
  for (const input of inputs) {
    const text = await readFile(join(workspace, input), 'utf8');
    const [header, ...rows] = text.trim().split('\n');
    const column = header.split(',').indexOf('age');
    for (const row of rows) {
      const cell = row.split(',')[column];
      if (cell !== undefined && cell.trim() !== '') ages.push(Number(cell));
    }
  }

  const n = ages.length;
  const mean = n === 0 ? 0 : Math.round((ages.reduce((a, b) => a + b, 0) / n) * 10) / 10;

  let body;
  if (flags.has('--malformed')) {
    body = 'this is not JSON';
  } else if (flags.has('--bad-shape')) {
    body = JSON.stringify({ results: [{ key: 'mean_age' }] });
  } else if (flags.has('--blank-summary')) {
    body = JSON.stringify({ results: [{ key: 'mean_age', summary: '   ', values: { mean } }] });
  } else {
    body = JSON.stringify(
      {
        results: [
          {
            key: 'mean_age',
            summary: flags.has('--stable-summary')
              ? 'Mean respondent age'
              : `Mean respondent age is ${mean} years`,
            values: { mean, n },
            unit: 'years',
          },
          {
            key: 'row_count',
            summary: `The survey holds ${n} usable responses`,
            values: { n },
          },
        ],
        notes: [`ran as ${analysis}`],
      },
      null,
      2,
    );
  }

  if (!flags.has('--no-output')) {
    await mkdir(join(workspace, dirname(out)), { recursive: true });
    await writeFile(join(workspace, out), body + '\n');
  }
  if (flags.has('--extra-file')) {
    const extra = join(workspace, dirname(out), 'summary.csv');
    await writeFile(extra, `mean,n\n${mean},${n}\n`);
  }
}
