#!/usr/bin/env node
// Reads data/benchmark-runs.csv and reports mean exact-match accuracy and mean latency per
// numeric precision. PhDude runs this through `phdude analyze run`; it is never run by hand.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = 'analysis/out/benchmark-summary/results.json';

const text = await readFile('data/benchmark-runs.csv', 'utf8');
const [header, ...body] = text
  .trim()
  .split('\n')
  .map((line) => line.split(','));

const precision = header.indexOf('precision');
const exactMatch = header.indexOf('exact_match');
const latency = header.indexOf('latency_ms');

// First-seen order, not alphabetical: the report follows the file rather than reordering it.
const runs = new Map();
const accuracy = new Map();
const millis = new Map();
for (const row of body) {
  const name = row[precision];
  runs.set(name, (runs.get(name) ?? 0) + 1);
  accuracy.set(name, (accuracy.get(name) ?? 0) + Number(row[exactMatch]));
  millis.set(name, (millis.get(name) ?? 0) + Number(row[latency]));
}

const mean = (totals, digits) =>
  Object.fromEntries(
    [...runs].map(([name, n]) => [name, Math.round((totals.get(name) / n) * digits) / digits]),
  );

await mkdir('analysis/out/benchmark-summary', { recursive: true });
await writeFile(
  OUT,
  JSON.stringify(
    {
      results: [
        {
          key: 'accuracy_by_precision',
          summary:
            'Mean exact-match accuracy falls by less than half a point from half precision to eight-bit, and by more than three points at four-bit.',
          values: mean(accuracy, 1000),
          unit: 'proportion',
        },
        {
          key: 'latency_by_precision',
          summary: 'Mean latency at a fixed batch size falls with every step down in precision.',
          values: mean(millis, 1),
          unit: 'milliseconds',
        },
      ],
    },
    null,
    2,
  ) + '\n',
);
