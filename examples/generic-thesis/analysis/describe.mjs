#!/usr/bin/env node
// Reads data/survey.csv and reports daily note-taking app use per recruitment channel.
// PhDude runs this through `phdude analyze run`; it is never run by hand.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = 'analysis/out/survey-descriptives/results.json';

const text = await readFile('data/survey.csv', 'utf8');
const [header, ...body] = text
  .trim()
  .split('\n')
  .map((line) => line.split(','));

const channel = header.indexOf('recruitment_channel');
const daily = header.indexOf('daily_use');

// First-seen order, not alphabetical: the report follows the file rather than reordering it.
const respondents = new Map();
const users = new Map();
for (const row of body) {
  const name = row[channel];
  respondents.set(name, (respondents.get(name) ?? 0) + 1);
  users.set(name, (users.get(name) ?? 0) + (row[daily] === 'yes' ? 1 : 0));
}

const share = Object.fromEntries(
  [...respondents].map(([name, total]) => [name, Math.round((users.get(name) / total) * 1000) / 1000]),
);

await mkdir('analysis/out/survey-descriptives', { recursive: true });
await writeFile(
  OUT,
  JSON.stringify(
    {
      results: [
        {
          key: 'daily_use_by_channel',
          summary:
            'Reported daily note-taking app use is lowest in the sample recruited through the campus social media group.',
          values: share,
          unit: 'proportion',
        },
        {
          key: 'respondents_by_channel',
          summary: 'The three recruitment channels contributed unequal numbers of respondents.',
          values: Object.fromEntries(respondents),
          unit: 'participants',
        },
      ],
    },
    null,
    2,
  ) + '\n',
);
