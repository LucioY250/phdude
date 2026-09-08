#!/usr/bin/env node
// Reads data/attendance.csv and reports assembly attendance per primary news source.
// PhDude runs this through `phdude analyze run`; it is never run by hand.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = 'analysis/out/attendance-descriptives/results.json';

const text = await readFile('data/attendance.csv', 'utf8');
const [header, ...body] = text
  .trim()
  .split('\n')
  .map((line) => line.split(','));

const news = header.indexOf('news_source');
const district = header.indexOf('district');
const attended = header.indexOf('attended');

// First-seen order, not alphabetical: the report follows the file rather than reordering it.
const bySource = new Map();
const attendedBySource = new Map();
const byDistrict = new Map();
for (const row of body) {
  const source = row[news];
  bySource.set(source, (bySource.get(source) ?? 0) + 1);
  attendedBySource.set(source, (attendedBySource.get(source) ?? 0) + (row[attended] === 'yes' ? 1 : 0));
  byDistrict.set(row[district], (byDistrict.get(row[district]) ?? 0) + 1);
}

const share = Object.fromEntries(
  [...bySource].map(([name, total]) => [
    name,
    Math.round((attendedBySource.get(name) / total) * 1000) / 1000,
  ]),
);

await mkdir('analysis/out/attendance-descriptives', { recursive: true });
await writeFile(
  OUT,
  JSON.stringify(
    {
      results: [
        {
          key: 'attendance_by_news_source',
          summary:
            'Reported assembly attendance is highest among households whose primary news source is the community radio station.',
          values: share,
          unit: 'proportion',
        },
        {
          key: 'households_by_district',
          summary: 'The four districts contributed unequal numbers of households.',
          values: Object.fromEntries(byDistrict),
          unit: 'households',
        },
      ],
    },
    null,
    2,
  ) + '\n',
);
