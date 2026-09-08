#!/usr/bin/env node
// Regenerates the three cross-field example workspaces under examples/ - a quantitative social
// science study, a machine learning benchmark paper and a qualitative archival study - by
// driving the same use cases the CLI drives, against the same fixed clock the thesis example
// uses (scripts/lib/example-builder.mjs).
//
// They exist to be compared. Nothing in src/ knows which of them it is serving: the same
// `status`, `next`, `gaps`, `health` and `ready` read three different disciplines, and the only
// thing that differs is which packs the workspace applied and what its researcher wrote down.
//
//   node scripts/make-examples.mjs             # all three
//   node scripts/make-examples.mjs machine-learning
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEntity } from '../src/application/add.js';
import { promote, propose } from '../src/application/decide.js';
import { link } from '../src/application/link.js';
import * as analyze from '../src/application/analyze.js';
import * as data from '../src/application/data.js';
import * as figure from '../src/application/figure.js';
import * as manuscript from '../src/application/manuscript.js';
import * as packs from '../src/application/packs.js';
import * as profile from '../src/application/profile.js';
import * as prose from '../src/application/prose.js';
import * as table from '../src/application/table.js';
import {
  EXAMPLES_DIR,
  acceptCandidate,
  addAuthorProfile,
  approveSection,
  atomFeed,
  buildExample,
  invertedAbstract,
  recordReview,
  recordSearch,
  submitDraft,
  withAnalysis,
} from './lib/example-builder.mjs';

// The writing loop every example carries, so the three differ in what they say and not in how
// much of the pipeline they exercise: a plan, a draft, one revision that removes the filler, the
// prose report, and an approval with a Decision behind it.
async function writeIntroduction(deps, { voice, draft, revised, title, rationale }) {
  await manuscript.init(deps, { language: 'en', voice });

  await submitDraft(deps, 'introduction', draft);
  await submitDraft(deps, 'introduction', revised, { revision: true });

  await prose.proseSection(deps, 'introduction');

  await approveSection(deps, { section: 'introduction', title, rationale });
}

// ---------------------------------------------------------------------------------------------
// quantitative-social-science
// ---------------------------------------------------------------------------------------------

const SOCIAL_SOURCES = {
  'sources/wave-one-report.md': `# Household Survey, Wave One

## Methods

A stratified household survey covering 1204 households across four municipal districts asked
whether anyone in the household had attended a participatory budgeting assembly in the past year.

## Results

Attendance was reported most often by households whose primary news source is the community
radio station.
`,
  'sources/wave-two-report.md': `# Household Survey, Wave Two

## Methods

The second wave repeated the instrument with 1180 households drawn from the same municipal
register twelve months later.

## Results

Reported attendance fell in every district except the one the community radio station covers.
`,
  // Classified below as `notes` and deliberately never mined: the codebook is the kind of file
  // a real workspace accumulates and never turns into knowledge, which is `artifact-unmined`.
  'sources/instrument-codebook.md': `# Instrument codebook

Variable definitions for the two survey waves: district, primary news source, and the single
attendance item. Nothing here has been turned into a source, a fact or an evidence item yet.
`,
};

// Twenty-four synthetic households, four districts, three primary news sources, one yes/no
// attendance item. Small enough to read in the diff, and shaped so the analysis over it has
// something to say about the question the example already asks.
const ATTENDANCE_CSV =
  [
    'household_id,district,news_source,attended',
    'H01,Centro,community radio,yes',
    'H02,Centro,community radio,yes',
    'H03,Norte,community radio,yes',
    'H04,Norte,community radio,no',
    'H05,Ribera,community radio,yes',
    'H06,Ribera,community radio,yes',
    'H07,Alto,community radio,yes',
    'H08,Alto,community radio,no',
    'H09,Centro,municipal bulletin,yes',
    'H10,Centro,municipal bulletin,no',
    'H11,Centro,municipal bulletin,yes',
    'H12,Norte,municipal bulletin,no',
    'H13,Norte,municipal bulletin,yes',
    'H14,Ribera,municipal bulletin,no',
    'H15,Ribera,municipal bulletin,yes',
    'H16,Alto,municipal bulletin,no',
    'H17,Centro,social platform,yes',
    'H18,Centro,social platform,no',
    'H19,Centro,social platform,no',
    'H20,Norte,social platform,yes',
    'H21,Norte,social platform,no',
    'H22,Norte,social platform,no',
    'H23,Alto,social platform,yes',
    'H24,Alto,social platform,no',
  ].join('\n') + '\n';

const ATTENDANCE_SCRIPT = `#!/usr/bin/env node
// Reads data/attendance.csv and reports assembly attendance per primary news source.
// PhDude runs this through \`phdude analyze run\`; it is never run by hand.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = 'analysis/out/attendance-descriptives/results.json';

const text = await readFile('data/attendance.csv', 'utf8');
const [header, ...body] = text
  .trim()
  .split('\\n')
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
  ) + '\\n',
);
`;

const SOCIAL_FIGURE_ALT =
  'Bar chart: Centro contributed 8 of the 24 surveyed households, Norte 7, Ribera 4 and Alto 5.';

const RESEARCHER_B_PROFILE = {
  id: 'researcher-b',
  name: 'Researcher B',
  language: 'en',
  tone: { academic: true, assertiveness: 'low', first_person: 'never' },
  sentences: { length: 'varied', openings: 'varied' },
  paragraphs: { density: 'medium' },
  transitions: 'minimal',
  terminology: {
    preserve: ['participatory budgeting', 'primary news source'],
    avoid: ['impactful', 'game-changing', 'synergy'],
  },
};

const RESEARCHER_B_SAMPLE = `Reported attendance at participatory budgeting assemblies varies with the \
medium a household relies on for municipal news, and the direction of that variation is the same \
in both survey waves. Households whose primary news source is the community radio station \
reported attending more often than households relying on the printed municipal bulletin, and \
those relying on a social platform reported the lowest attendance of the three groups.

The comparison is descriptive. Households were not assigned to a news source, and the districts \
the community radio station covers differ from the others in ways the instrument does not \
measure: distance to the assembly hall, the hour at which assemblies are held, and the presence \
of a residents' committee that predates the budgeting process. Any of these could produce the \
same pattern without the medium mattering at all.

What the two waves do establish is that the pattern is not an artefact of a single fieldwork \
period. The second wave repeated the instrument with a fresh sample from the same municipal \
register a year later and recovered the same ordering, with attendance falling in three of the \
four districts. A single wave could not distinguish that ordering from sampling noise; two \
waves narrow the range of explanations without settling on one.`;

const SOCIAL_OPENALEX_RESPONSE = {
  results: [
    {
      id: 'https://openalex.org/W4392007311',
      doi: 'https://doi.org/10.5555/jcs.2024.0188',
      display_name: 'Local Media Repertoires and Attendance at Municipal Assemblies',
      publication_year: 2024,
      language: 'en',
      type: 'article',
      primary_location: {
        landing_page_url: 'https://example.org/articles/local-media-repertoires',
        source: { display_name: 'Journal of Civic Studies' },
      },
      open_access: { is_oa: true },
      cited_by_count: 21,
      authorships: [
        { author: { display_name: 'N. Quispe' } },
        { author: { display_name: 'O. Ramires' } },
      ],
      abstract_inverted_index: invertedAbstract(
        'Across eleven municipalities we relate the news media households rely on to their ' +
          'attendance at participatory budgeting assemblies, and find the association survives ' +
          'adjustment for district income.',
      ),
    },
    {
      id: 'https://openalex.org/W4306612077',
      doi: null,
      display_name: 'Who Shows Up? Attendance Registers Versus Self-Reported Participation',
      publication_year: 2022,
      language: 'en',
      type: 'preprint',
      primary_location: {
        landing_page_url: 'https://example.org/preprints/who-shows-up',
        source: { display_name: 'Open Governance Preprints' },
      },
      open_access: { is_oa: true },
      cited_by_count: 6,
      authorships: [{ author: { display_name: 'P. Salazar' } }],
    },
  ],
};

// The middle paragraph is the filler a model reaches for when it has nothing to say: an appeal
// to "the literature" with nobody cited, and an intensifier standing in for a number.
function socialDraft(claim) {
  return [
    'Households whose primary news source is the community radio station report attending',
    'participatory budgeting assemblies more often than other households [@ibarra2025municipal].',
    `<!-- claim: ${claim.id} -->`,
    '',
    'It is important to note that the literature suggests local media play a significant role in',
    'civic participation across municipalities.',
    '',
    'Whether the medium itself matters is the open question. The two waves did not sample the same',
    'households, and the districts do not agree on how far the assembly hall is, so this study asks',
    'whether attendance tracks the primary news source or the district.',
  ].join('\n');
}

function socialRevised(claim) {
  return [
    'Households whose primary news source is the community radio station report attending',
    'participatory budgeting assemblies more often than other households [@ibarra2025municipal].',
    `<!-- claim: ${claim.id} -->`,
    '',
    'The two waves recruited from the same municipal register a year apart, and the ordering of the',
    'three news sources was the same in both.',
    '',
    'Whether the medium itself matters is therefore the open question. The two waves did not sample',
    'the same households, and the districts do not agree on how far the assembly hall is, so this',
    'study asks whether attendance tracks the primary news source or the district.',
  ].join('\n');
}

// The v0.5 half of the example: a registered dataset, an analysis run under the execution
// policy, the two RESULTs it reported, a table over one of them and a figure drawn from the
// other, and the evidence that carries a result into the argument.
async function analyseAttendance(deps, claim) {
  await deps.store.writeTextAtomic('data/attendance.csv', ATTENDANCE_CSV);
  await deps.store.writeTextAtomic('analysis/attendance.mjs', ATTENDANCE_SCRIPT);

  const { dataset } = await data.add(deps, 'data/attendance.csv');

  const { analysis } = await analyze.add(deps, {
    name: 'attendance descriptives',
    runtime: 'node',
    script: 'analysis/attendance.mjs',
    inputs: [dataset.id],
  });
  const run = await analyze.run(deps, { id: analysis.id, allowExec: true });
  const byKey = (key) => run.created.find((r) => r.ext.analysis.key === key);
  const share = byKey('attendance_by_news_source');
  const households = byKey('households_by_district');

  const declared = await table.add(deps, {
    name: 'attendance-by-news-source',
    caption: 'Reported attendance at a participatory budgeting assembly, by primary news source.',
    source: { result: share.id },
    columns: [
      { key: 'key', label: 'Primary news source' },
      { key: 'value', label: 'Attended', format: 'percent:0' },
    ],
  });
  await table.build(deps, declared.table.id);

  const drawn = await figure.add(deps, {
    name: 'households-by-district',
    caption: 'Surveyed households by district.',
    alt: SOCIAL_FIGURE_ALT,
    generator: {
      runtime: 'node',
      script: 'phdude:bar-chart',
      args: [
        '--input',
        'analysis/out/attendance-descriptives/results.json',
        '--key',
        'households_by_district',
        '--out',
        'figures/out/households-by-district.svg',
        '--title',
        'Surveyed households by district',
        '--alt',
        SOCIAL_FIGURE_ALT,
      ],
    },
    inputs: [households.id],
    outputs: [{ path: 'figures/out/households-by-district.svg', format: 'svg' }],
  });
  await figure.build(deps, drawn.figure.id, { allowExec: true });

  // DATASET → ANALYSIS → RESULT → evidence → claim, end to end. The other result is left
  // uncited, which is the `result-uncited` gap.
  const { obj: evidence } = await addEntity(deps, 'evidence', {
    source: share.id,
    locator: 'attendance_by_news_source',
    excerpt:
      'Attendance is reported by 75% of households relying on the community radio station, 50% ' +
      'of those relying on the municipal bulletin and 38% of those relying on a social platform.',
    strength: 'moderate',
  });
  await link(deps, claim.id, { to: [evidence.id] });

  return { analysis, dataset };
}

export const quantitativeSocialScience = {
  name: 'quantitative-social-science',
  title: 'Participatory Budgeting Attendance Study',
  venue: 'generic-thesis',
  sources: SOCIAL_SOURCES,
  async build(deps, { root, artifactId }) {
    const artWaveOne = artifactId('sources/wave-one-report.md');
    const artWaveTwo = artifactId('sources/wave-two-report.md');
    const artCodebook = artifactId('sources/instrument-codebook.md');

    await addEntity(deps, 'artifact-role', { id: artCodebook, role: 'notes' });

    const { obj: srcWaves } = await addEntity(deps, 'source', {
      title: 'Municipal Household Survey, Waves One and Two',
      authors: ['L. Ibarra'],
      year: 2025,
      type: 'report',
      artifacts: [artWaveOne, artWaveTwo],
    });
    const { obj: srcMedia } = await addEntity(deps, 'source', {
      title: 'Local Media Ecologies and Civic Participation',
      authors: ['M. Okonjo'],
      year: 2023,
      venue: 'Journal of Civic Studies',
      type: 'article',
      identifiers: { doi: '10.5555/jcs.2023.0311' },
      artifacts: [],
    });

    const { obj: rq1 } = await addEntity(deps, 'question', {
      text: 'Does attendance at participatory budgeting assemblies differ by the primary news source a household relies on?',
      objectives: [
        'Compare reported assembly attendance across households grouped by primary news source.',
      ],
    });
    // No method covers this one and no claim addresses it - `question-without-method` and
    // `question-without-claims`, which is the state a second research question usually starts in.
    const { obj: rq2 } = await addEntity(deps, 'question', {
      text: 'Does assembly attendance change between survey waves within the same district?',
      objectives: ['Compare attendance across the two waves district by district.'],
    });

    await addEntity(deps, 'hypothesis', {
      text: 'Districts covered by the community radio station sustain attendance between waves.',
      questions: [rq2.id],
    });

    const { obj: method } = await addEntity(deps, 'method', {
      name: 'Two-wave household survey',
      design:
        'Repeated cross-sectional survey of the municipal household register, two waves twelve months apart.',
      paradigm: 'quantitative',
      sampling: 'Stratified random sample from the municipal household register, four districts.',
      instruments: ['participatory budgeting attendance questionnaire'],
      analysis: ['descriptive comparison of reported attendance by primary news source'],
      limitations: ['self-reported attendance', 'one municipality'],
      questions: [rq1.id],
    });

    const { obj: evWaveOne } = await addEntity(deps, 'evidence', {
      source: artWaveOne,
      locator: 'Results',
      excerpt:
        'Attendance was reported most often by households whose primary news source is the community radio station (wave one).',
      strength: 'moderate',
    });
    const { obj: evWaveTwo } = await addEntity(deps, 'evidence', {
      source: artWaveTwo,
      locator: 'Results',
      excerpt:
        'Reported attendance fell in every district except the one the community radio station covers (wave two).',
      strength: 'moderate',
    });
    const { obj: evMedia } = await addEntity(deps, 'evidence', {
      source: srcMedia.id,
      locator: 'Discussion',
      excerpt:
        'Households relying on locally produced broadcast media participate in municipal processes more often than households relying on national outlets.',
      strength: 'weak',
    });
    // Cites the two-wave report by its SRC id rather than an artifact, which is what makes the
    // source count as cited in the registry (`phdude cite list|check|export`).
    await addEntity(deps, 'evidence', {
      source: srcWaves.id,
      locator: 'Methods',
      excerpt:
        'Both waves drew a stratified sample from the same municipal household register across four districts.',
      strength: 'moderate',
    });

    const { obj: claimAttendance } = await addEntity(deps, 'claim', {
      statement:
        'Households whose primary news source is the community radio station report attending participatory budgeting assemblies more often than other households.',
      kind: 'empirical',
      supported_by: [evWaveOne.id, evWaveTwo.id],
      questions: [rq1.id],
      sections: ['Introduction', 'Results'],
    });
    await promote(deps, claimAttendance.id, { to: 'supported' });

    // The claim the analysis result is linked to below; still `candidate` until the second wave
    // is analysed the same way.
    const { obj: claimDistrict } = await addEntity(deps, 'claim', {
      statement:
        'Attendance may track the reach of local media rather than the income of the district.',
      kind: 'empirical',
    });
    // Rests on weak evidence only - `claim-weak-evidence`.
    await addEntity(deps, 'claim', {
      statement: 'Locally produced broadcast media are associated with municipal participation.',
      kind: 'literature',
      supported_by: [evMedia.id],
      questions: [rq1.id],
      sections: ['Discussion'],
    });

    // Fact ids are content-derived from `key + value + from.artifact`, so the two waves reporting
    // different denominators are two FACT records and one open conflict.
    const { obj: factOne } = await addEntity(deps, 'fact', {
      key: 'households_surveyed',
      value: 1204,
      unit: 'households',
      from: { artifact: artWaveOne, locator: 'Methods' },
    });
    const { obj: factTwo } = await addEntity(deps, 'fact', {
      key: 'households_surveyed',
      value: 1180,
      unit: 'households',
      from: { artifact: artWaveTwo, locator: 'Methods' },
    });

    // A search recorded more than a year before the rest of the workspace, so `phdude gaps` and
    // `phdude next` both call it stale. The preprint stays pending: the policy requires approval.
    await acceptCandidate(
      deps,
      await recordSearch(deps, {
        query: 'participatory budgeting attendance local media',
        question: rq1.id,
        at: '2025-04-01T00:00:00Z',
        provider: 'openalex',
        routes: [{ match: 'api.openalex.org', body: SOCIAL_OPENALEX_RESPONSE }],
      }),
    );

    await addAuthorProfile(deps, root, RESEARCHER_B_PROFILE, RESEARCHER_B_SAMPLE);

    await propose(deps, {
      title: 'Reconcile the households_surveyed denominator across the two waves',
      rationale:
        'Wave one reports 1204 households and wave two 1180; the two are different samples, so ' +
        'the write-up has to say which denominator any pooled rate is computed against.',
      affects: [factOne.id, factTwo.id],
      change: { fact_key: 'households_surveyed', canonical_value: 1204 },
    });

    await writeIntroduction(deps, {
      voice: RESEARCHER_B_PROFILE.id,
      draft: socialDraft(claimAttendance),
      revised: socialRevised(claimAttendance),
      title: 'Approve the introduction as revised',
      rationale:
        'The section asserts one supported claim with the two waves behind it, and the revision ' +
        'replaced the appeal to the literature with what the workspace can show.',
    });

    const { analysis } = await analyseAttendance(withAnalysis(deps, root), claimDistrict);

    await packs.apply(deps, 'quantitative');
    await packs.apply(deps, 'generic-thesis');
    await profile.use(deps, 'generic-thesis');

    await recordReview(deps, 'methodology', [
      {
        target: method.id,
        severity: 'major',
        message:
          'Households were not assigned to a news source and the design records no adjustment ' +
          'for district, so the reported ordering cannot be read as an effect of the medium.',
        evidence: [evWaveOne.id, evWaveTwo.id],
        suggested_command: `phdude decide propose --title "Adjust the attendance comparison for district" --affects ${analysis.id}`,
      },
    ]);
  },
};

// ---------------------------------------------------------------------------------------------
// machine-learning
// ---------------------------------------------------------------------------------------------

const ML_SOURCES = {
  'sources/arxiv-2402-09113.md': `# Reading notes: arXiv:2402.09113

## Claim

Eight-bit post-training quantization is reported to leave exact-match accuracy unchanged within
run-to-run variation on extractive question answering.

## Setup

Three seeds per configuration, one benchmark, accuracy reported as exact match on the published
held-out split.
`,
  'sources/arxiv-2406-02871.md': `# Reading notes: arXiv:2406.02871

## Claim

The same quantization recipe is reported to cost accuracy once the evaluation prompts are held
out rather than reused from the calibration set.

## Setup

Five seeds per configuration, the same benchmark, accuracy reported as exact match.
`,
  // Classified below as `notes` and deliberately never mined - `artifact-unmined`.
  'sources/benchmark-card.md': `# Benchmark card

Provenance, licence and split sizes for the question answering benchmark the recorded runs score
against. Nothing here has been turned into a source, a fact or an evidence item yet.
`,
};

// Fifteen recorded runs: three numeric precisions, five seeds each, exact-match accuracy and
// median latency at a fixed batch size. The numbers are synthetic and chosen to average cleanly.
const BENCHMARK_CSV =
  [
    'run_id,precision,seed,exact_match,latency_ms',
    'run01,fp16,1,0.812,240',
    'run02,fp16,2,0.808,236',
    'run03,fp16,3,0.810,244',
    'run04,fp16,4,0.814,238',
    'run05,fp16,5,0.806,242',
    'run06,int8,1,0.806,152',
    'run07,int8,2,0.802,148',
    'run08,int8,3,0.808,150',
    'run09,int8,4,0.804,154',
    'run10,int8,5,0.810,146',
    'run11,int4,1,0.771,118',
    'run12,int4,2,0.769,122',
    'run13,int4,3,0.773,120',
    'run14,int4,4,0.767,116',
    'run15,int4,5,0.775,124',
  ].join('\n') + '\n';

const BENCHMARK_SCRIPT = `#!/usr/bin/env node
// Reads data/benchmark-runs.csv and reports mean exact-match accuracy and mean latency per
// numeric precision. PhDude runs this through \`phdude analyze run\`; it is never run by hand.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = 'analysis/out/benchmark-summary/results.json';

const text = await readFile('data/benchmark-runs.csv', 'utf8');
const [header, ...body] = text
  .trim()
  .split('\\n')
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
  ) + '\\n',
);
`;

const ML_FIGURE_ALT =
  'Bar chart: mean inference latency at a fixed batch size falls from 240 ms at half precision ' +
  'to 150 ms at eight-bit and 120 ms at four-bit precision.';

const RESEARCHER_C_PROFILE = {
  id: 'researcher-c',
  name: 'Researcher C',
  language: 'en',
  tone: { academic: true, assertiveness: 'moderate', first_person: 'sparing' },
  sentences: { length: 'short', openings: 'varied' },
  paragraphs: { density: 'high' },
  transitions: 'minimal',
  terminology: {
    preserve: ['exact match', 'held-out split', 'post-training quantization'],
    avoid: ['state-of-the-art', 'novel', 'seamless'],
  },
};

const RESEARCHER_C_SAMPLE = `Post-training quantization trades accuracy for throughput, and the size \
of that trade is what the recorded runs are for. Across five seeds per configuration, mean \
exact-match accuracy on the held-out split falls by less than half a point when the weights move \
from half precision to eight bits. It falls by more than three points at four bits. The latency \
saving moves in the opposite direction and is larger at every step.

Neither number settles the question the two preprints disagree about. Both were measured on the \
same benchmark, with the same scorer, on one hardware configuration, and the evaluation prompts \
were the ones the benchmark publishes rather than a held-out set of our own. A recipe that looks \
lossless under the published prompts can still lose accuracy under prompts it was not calibrated \
against, which is exactly the disagreement in the literature.

The runs are recorded so that this can be checked rather than argued. Every configuration names \
its seeds, the dataset is registered with its hash, and the analysis that produced both summaries \
is a single script over the same file. What the runs do not record is the library version and the \
hardware, which is the first thing another group would need in order to reproduce the latency \
column.`;

const ML_ARXIV_FEED = atomFeed([
  {
    id: '2401.05512v1',
    published: '2024-01-10T18:22:41Z',
    title: 'Calibration Sets for Post-Training Quantization of Reading-Comprehension Models',
    summary:
      'We study how the choice of calibration set changes the accuracy cost of eight-bit ' +
      'post-training quantization on extractive question answering benchmarks.',
    authors: ['V. Petrov', 'W. Zhang'],
  },
  {
    id: '2312.11044v2',
    published: '2023-12-18T09:04:17Z',
    title: 'Prompt Sensitivity in Quantized Extractive Question Answering',
    summary:
      'Quantized models score close to their full-precision baselines under published prompts ' +
      'and lose accuracy under paraphrased ones.',
    authors: ['X. Duarte'],
  },
]);

function mlDraft(claim) {
  return [
    'Eight-bit post-training quantization changes exact-match accuracy on this benchmark by less',
    'than half a point across five seeds [@aoki2024posttraining].',
    `<!-- claim: ${claim.id} -->`,
    '',
    'It is important to note that the literature suggests low-precision inference has become a',
    'significant part of modern deployment practice.',
    '',
    'What that costs under prompts the recipe was not calibrated against is not settled. Two',
    'preprints report the same recipe and do not agree, so this paper asks what the accuracy cost',
    'is once the evaluation prompts are held out.',
  ].join('\n');
}

function mlRevised(claim) {
  return [
    'Eight-bit post-training quantization changes exact-match accuracy on this benchmark by less',
    'than half a point across five seeds [@aoki2024posttraining].',
    `<!-- claim: ${claim.id} -->`,
    '',
    'The same recipe cuts mean latency at a fixed batch size from 240 ms to 150 ms, which is the',
    'reason the trade is made at all.',
    '',
    'What it costs under prompts the recipe was not calibrated against is not settled. Two',
    'preprints report the same recipe and do not agree, so this paper asks what the accuracy cost',
    'is once the evaluation prompts are held out.',
  ].join('\n');
}

async function analyseBenchmark(deps, claim) {
  await deps.store.writeTextAtomic('data/benchmark-runs.csv', BENCHMARK_CSV);
  await deps.store.writeTextAtomic('analysis/benchmark.mjs', BENCHMARK_SCRIPT);

  const { dataset } = await data.add(deps, 'data/benchmark-runs.csv');

  const { analysis } = await analyze.add(deps, {
    name: 'benchmark summary',
    runtime: 'node',
    script: 'analysis/benchmark.mjs',
    inputs: [dataset.id],
  });
  const run = await analyze.run(deps, { id: analysis.id, allowExec: true });
  const byKey = (key) => run.created.find((r) => r.ext.analysis.key === key);
  const accuracy = byKey('accuracy_by_precision');
  const latency = byKey('latency_by_precision');

  // The benchmark results table the paper reports, built from the RESULT rather than retyped
  // from it: `phdude repro check` can then say whether the table still matches the run.
  const declared = await table.add(deps, {
    name: 'accuracy-by-precision',
    caption: 'Mean exact-match accuracy on the held-out split, by numeric precision.',
    source: { result: accuracy.id },
    columns: [
      { key: 'key', label: 'Precision' },
      { key: 'value', label: 'Exact match', format: 'percent:1' },
    ],
  });
  await table.build(deps, declared.table.id);

  const drawn = await figure.add(deps, {
    name: 'latency-by-precision',
    caption: 'Mean inference latency at a fixed batch size, by numeric precision.',
    alt: ML_FIGURE_ALT,
    generator: {
      runtime: 'node',
      script: 'phdude:bar-chart',
      args: [
        '--input',
        'analysis/out/benchmark-summary/results.json',
        '--key',
        'latency_by_precision',
        '--out',
        'figures/out/latency-by-precision.svg',
        '--title',
        'Mean latency by precision',
        '--alt',
        ML_FIGURE_ALT,
      ],
    },
    inputs: [latency.id],
    outputs: [{ path: 'figures/out/latency-by-precision.svg', format: 'svg' }],
  });
  await figure.build(deps, drawn.figure.id, { allowExec: true });

  const { obj: evidence } = await addEntity(deps, 'evidence', {
    source: accuracy.id,
    locator: 'accuracy_by_precision',
    excerpt:
      'Mean exact-match accuracy is 81.0% at half precision, 80.6% at eight-bit and 77.1% at ' +
      'four-bit precision.',
    strength: 'moderate',
  });
  await link(deps, claim.id, { to: [evidence.id] });

  return { analysis, dataset };
}

export const machineLearning = {
  name: 'machine-learning',
  title: 'Quantized Inference Benchmark Study',
  venue: 'ieee',
  sources: ML_SOURCES,
  async build(deps, { root, artifactId }) {
    const artLossless = artifactId('sources/arxiv-2402-09113.md');
    const artPrompts = artifactId('sources/arxiv-2406-02871.md');
    const artCard = artifactId('sources/benchmark-card.md');

    await addEntity(deps, 'artifact-role', { id: artCard, role: 'notes' });

    // An arXiv-style source set: two preprints addressed by their arXiv ids, and one published
    // survey with a DOI. Preprints are ordinary sources here; what the policy gates is accepting
    // one out of a search without a researcher saying yes.
    const { obj: srcLossless } = await addEntity(deps, 'source', {
      title: 'Post-Training Quantization Without Accuracy Loss',
      authors: ['R. Aoki', 'S. Berhane'],
      year: 2024,
      type: 'preprint',
      identifiers: { arxiv: '2402.09113' },
      artifacts: [artLossless],
    });
    // Cited by no evidence of its own, which is the informational `uncited-source` finding
    // `phdude cite check` reports: a source you have read and recorded but not yet drawn on.
    await addEntity(deps, 'source', {
      title: 'Re-Evaluating Quantized Question Answering Under Held-Out Prompts',
      authors: ['T. Camara'],
      year: 2024,
      type: 'preprint',
      identifiers: { arxiv: '2406.02871' },
      artifacts: [artPrompts],
    });
    const { obj: srcSurvey } = await addEntity(deps, 'source', {
      title: 'A Survey of Low-Precision Inference for Transformer Models',
      authors: ['U. Nakamura'],
      year: 2023,
      venue: 'Transactions on Efficient Inference',
      type: 'article',
      identifiers: { doi: '10.4444/tei.2023.0077' },
      artifacts: [],
    });

    const { obj: rq1 } = await addEntity(deps, 'question', {
      text: 'What does eight-bit post-training quantization cost in exact-match accuracy on extractive question answering?',
      objectives: [
        'Score three numeric precisions on one held-out benchmark split across five seeds each.',
      ],
    });
    const { obj: rq2 } = await addEntity(deps, 'question', {
      text: 'How much latency does each step down in precision buy at a fixed batch size?',
      objectives: ['Record median latency per precision under one hardware configuration.'],
    });
    // Neither a claim nor a method reaches this one yet - `question-without-claims` and
    // `question-without-method`.
    const { obj: rq3 } = await addEntity(deps, 'question', {
      text: 'Does the accuracy cost of quantization depend on the calibration set?',
      objectives: ['Compare calibration sets drawn from the training split and from the wild.'],
    });

    await addEntity(deps, 'hypothesis', {
      text: 'A calibration set drawn from the evaluation distribution hides the accuracy cost of quantization.',
      questions: [rq3.id],
    });

    const { obj: method } = await addEntity(deps, 'method', {
      name: 'Benchmark comparison across numeric precisions',
      design:
        'Three precisions scored on one held-out benchmark split, five seeds each, batch size fixed.',
      paradigm: 'computational',
      sampling: "The benchmark's published held-out split, unmodified.",
      instruments: ['exact-match scorer', 'fixed-batch latency harness'],
      analysis: ['mean exact-match accuracy per precision', 'mean latency per precision'],
      limitations: ['one benchmark', 'one hardware configuration', 'published prompts only'],
      questions: [rq1.id, rq2.id],
    });

    const { obj: evLossless } = await addEntity(deps, 'evidence', {
      source: artLossless,
      locator: 'Claim',
      excerpt:
        'Eight-bit post-training quantization leaves exact-match accuracy unchanged within run-to-run variation on extractive question answering.',
      strength: 'moderate',
    });
    const { obj: evPrompts } = await addEntity(deps, 'evidence', {
      source: artPrompts,
      locator: 'Claim',
      excerpt:
        'The same recipe costs accuracy once the evaluation prompts are held out rather than reused from the calibration set.',
      strength: 'moderate',
    });
    const { obj: evSurvey } = await addEntity(deps, 'evidence', {
      source: srcSurvey.id,
      locator: 'Section 4',
      excerpt:
        'Reported accuracy costs for eight-bit post-training quantization cluster below one point across published question answering benchmarks.',
      strength: 'moderate',
    });
    // Cites the preprint by its SRC id, so the registry counts it as cited.
    await addEntity(deps, 'evidence', {
      source: srcLossless.id,
      locator: 'Abstract',
      excerpt:
        'The recipe is evaluated on one benchmark with three seeds per configuration and no held-out prompt set.',
      strength: 'weak',
    });

    const { obj: claimCost } = await addEntity(deps, 'claim', {
      statement:
        'Eight-bit post-training quantization changes exact-match accuracy on this benchmark by less than half a point.',
      kind: 'empirical',
      supported_by: [evLossless.id, evSurvey.id],
      questions: [rq1.id],
      sections: ['Introduction', 'Results'],
    });
    await promote(deps, claimCost.id, { to: 'supported' });

    // The claim the accuracy result is linked to below.
    const { obj: claimFourBit } = await addEntity(deps, 'claim', {
      statement:
        'Four-bit precision costs materially more accuracy than eight-bit on this benchmark.',
      kind: 'empirical',
    });
    // Nothing supports this one yet - `claim-without-evidence`.
    await addEntity(deps, 'claim', {
      statement:
        'The latency saving from quantization is larger than the accuracy cost it charges.',
      kind: 'empirical',
      questions: [rq2.id],
      sections: ['Discussion'],
    });

    // The contradiction the field actually has: two preprints, the same recipe, incompatible
    // conclusions. Recording it moves both claims to `disputed` with no Decision, and they stay
    // there - resolving one is the researcher's call.
    const { obj: claimStable } = await addEntity(deps, 'claim', {
      statement: 'Quantized accuracy is stable across evaluation prompt sets.',
      kind: 'empirical',
      supported_by: [evLossless.id],
    });
    const { obj: claimSensitive } = await addEntity(deps, 'claim', {
      statement: 'Quantized accuracy drops once the evaluation prompts are held out.',
      kind: 'empirical',
      supported_by: [evPrompts.id],
    });
    await link(deps, claimStable.id, { contradicts: claimSensitive.id });

    // arXiv answers in Atom and only ever returns preprints, so every candidate here needs the
    // researcher's approval before it can become a source - which is the point of recording one.
    await acceptCandidate(
      deps,
      await recordSearch(deps, {
        query: 'post-training quantization extractive question answering',
        question: rq1.id,
        at: '2025-03-01T00:00:00Z',
        provider: 'arxiv',
        routes: [{ match: 'export.arxiv.org', body: ML_ARXIV_FEED }],
      }),
      { type: 'preprint', approve: { approvePreprint: true } },
    );

    await addAuthorProfile(deps, root, RESEARCHER_C_PROFILE, RESEARCHER_C_SAMPLE);

    await writeIntroduction(deps, {
      voice: RESEARCHER_C_PROFILE.id,
      draft: mlDraft(claimCost),
      revised: mlRevised(claimCost),
      title: 'Approve the introduction as revised',
      rationale:
        'The section asserts one supported claim and the revision replaced the appeal to the ' +
        'literature with the latency number the recorded runs report.',
    });

    const { analysis, dataset } = await analyseBenchmark(withAnalysis(deps, root), claimFourBit);

    // A venue with a page limit and a document class, so `phdude profile check` and
    // `phdude build --format latex --profile ieee` have something to check against.
    await packs.apply(deps, 'computer-science');
    await packs.apply(deps, 'ieee');
    await profile.use(deps, 'ieee');

    await recordReview(deps, 'reproducibility', [
      {
        target: analysis.id,
        severity: 'major',
        message:
          'The recorded runs name their seeds but not the inference library version or the ' +
          'accelerator, so the latency column cannot be reproduced elsewhere without guessing ' +
          'the environment.',
        evidence: [dataset.id, method.id],
        suggested_command: `phdude decide propose --title "Record the runtime environment with the benchmark runs" --affects ${dataset.id}`,
      },
    ]);
  },
};

// ---------------------------------------------------------------------------------------------
// qualitative-humanities
// ---------------------------------------------------------------------------------------------

const HUMANITIES_SOURCES = {
  'sources/letter-1873-05-12.md': `# Ossory to Devane, 12 May 1873

## Transcription

"...the catalogue you ask after was drawn up by the schoolmaster himself, who founded our little
society and kept its ledger until Michaelmas last."

## Provenance

Diocesan archive, Devane papers, box 4, folio 18. Single sheet, water damage at the fold.
`,
  'sources/letter-1874-02-03.md': `# Devane to Hackett, 3 February 1874

## Transcription

"...the society was got up by the subscribing merchants of the quay, who put their names to the
first list before ever the schoolmaster was applied to."

## Provenance

Diocesan archive, Devane papers, box 5, folio 3. Two sheets, endorsed in a later hand.
`,
  // Classified below as `notes` and deliberately never mined - `artifact-unmined`.
  'sources/finding-aid.md': `# Finding aid: Devane papers

Box-and-folio listing for the correspondence series, with dates and correspondents. Nothing here
has been turned into a source, a fact or an evidence item yet.
`,
};

const RESEARCHER_D_PROFILE = {
  id: 'researcher-d',
  name: 'Researcher D',
  language: 'en',
  tone: { academic: true, assertiveness: 'low', first_person: 'never' },
  sentences: { length: 'long', openings: 'varied' },
  paragraphs: { density: 'medium' },
  transitions: 'moderate',
  terminology: {
    preserve: ['reading society', 'subscription list', 'folio'],
    avoid: ['showcase', 'compelling', 'rich tapestry'],
  },
};

const RESEARCHER_D_SAMPLE = `The correspondence preserved in the Devane papers offers two \
incompatible accounts of how the reading society came to be, written nine months apart by \
correspondents who both had reason to know. The earlier letter credits the parish schoolmaster \
with founding the society and keeping its ledger; the later one credits a committee of \
subscribing merchants who, it says, had put their names to a first list before the schoolmaster \
was approached at all.

Neither account can be preferred on internal grounds alone. Both letters are single witnesses to \
events already some years past when they were written, both were addressed to correspondents who \
were not present at the founding, and the later letter is endorsed in a hand that cannot be \
dated. The subscription list that would settle the question is referred to in both letters and \
has not been located in the series, nor is it entered in the finding aid.

What the pair does establish is that the attribution was contested within the society's own \
lifetime rather than by later historians. That is a smaller finding than an answer, and it is \
the one the surviving folios support. Where the printed histories of provincial reading societies \
attribute their founding to tradesmen as a matter of course, the correspondence shows at least \
one society in which the question was open to the people who belonged to it.`;

const HUMANITIES_OPENALEX_RESPONSE = {
  results: [
    {
      id: 'https://openalex.org/W4385512900',
      doi: 'https://doi.org/10.6666/sbh.2023.0121',
      display_name: 'Subscription Lists and the Founding of Provincial Reading Societies',
      publication_year: 2023,
      language: 'en',
      type: 'article',
      primary_location: {
        landing_page_url: 'https://example.org/articles/subscription-lists',
        source: { display_name: 'Studies in Book History' },
      },
      open_access: { is_oa: true },
      cited_by_count: 12,
      authorships: [{ author: { display_name: 'Q. Fitzmaurice' } }],
      abstract_inverted_index: invertedAbstract(
        'Surviving subscription lists are read against the correspondence of five provincial ' +
          'reading societies to show how founding narratives were revised by their members.',
      ),
    },
    {
      id: 'https://openalex.org/W4225508113',
      doi: null,
      display_name: 'The Schoolmaster as Cultural Broker in the Provincial Town',
      publication_year: 2022,
      language: 'en',
      type: 'preprint',
      primary_location: {
        landing_page_url: 'https://example.org/preprints/schoolmaster-broker',
        source: { display_name: 'Open Humanities Preprints' },
      },
      open_access: { is_oa: true },
      cited_by_count: 3,
      authorships: [{ author: { display_name: 'R. Lynskey' } }],
    },
  ],
};

function humanitiesDraft(claim) {
  return [
    'The Devane correspondence attributes the founding of the reading society to two different',
    'parties within nine months [@archive1879devane].',
    `<!-- claim: ${claim.id} -->`,
    '',
    'It is important to note that the literature suggests provincial reading societies were',
    'significant institutions in the cultural life of the period.',
    '',
    'Which attribution the printed histories should have followed is not settled here. The',
    'subscription list both letters refer to has not been located, and the finding aid does not',
    'enter it, so this chapter asks what the correspondence alone can establish.',
  ].join('\n');
}

function humanitiesRevised(claim) {
  return [
    'The Devane correspondence attributes the founding of the reading society to two different',
    'parties within nine months [@archive1879devane].',
    `<!-- claim: ${claim.id} -->`,
    '',
    'The earlier letter credits the parish schoolmaster and the later one a committee of',
    'subscribing merchants, and both were written to correspondents who were not present.',
    '',
    'Which attribution the printed histories should have followed is not settled here. The',
    'subscription list both letters refer to has not been located, and the finding aid does not',
    'enter it, so this chapter asks what the correspondence alone can establish.',
  ].join('\n');
}

export const qualitativeHumanities = {
  name: 'qualitative-humanities',
  title: 'Provincial Reading Societies Study',
  venue: 'generic-thesis',
  sources: HUMANITIES_SOURCES,
  async build(deps, { root, artifactId }) {
    const artEarlier = artifactId('sources/letter-1873-05-12.md');
    const artLater = artifactId('sources/letter-1874-02-03.md');
    const artFindingAid = artifactId('sources/finding-aid.md');

    await addEntity(deps, 'artifact-role', { id: artFindingAid, role: 'notes' });

    const { obj: srcPapers } = await addEntity(deps, 'source', {
      title: 'Devane Papers, Correspondence Series 1871-1879',
      authors: ['Diocesan Archive'],
      year: 1879,
      type: 'other',
      artifacts: [artEarlier, artLater],
    });
    const { obj: srcMonograph } = await addEntity(deps, 'source', {
      title: 'Reading Societies of the Provincial Towns',
      authors: ['P. Ni Ghallchoir'],
      year: 2022,
      venue: 'Studies in Book History',
      type: 'book',
      identifiers: { doi: '10.6666/sbh.2022.0044' },
      artifacts: [],
    });

    const { obj: rq1 } = await addEntity(deps, 'question', {
      text: 'Who established the reading society recorded in the Devane correspondence?',
      objectives: [
        'Read the founding attributions in the correspondence series against the finding aid.',
      ],
    });
    // No claim addresses this one and no method covers it - `question-without-claims` and
    // `question-without-method`, the state a second chapter's question starts in.
    const { obj: rq2 } = await addEntity(deps, 'question', {
      text: 'How did the subscription lists shape what the society acquired?',
      objectives: [
        'Compare the surviving catalogue entries with the subscribers named in the letters.',
      ],
    });

    await addEntity(deps, 'hypothesis', {
      text: 'Acquisitions followed the occupations of the subscribers rather than the catalogue the schoolmaster drew up.',
      questions: [rq2.id],
    });

    const { obj: method } = await addEntity(deps, 'method', {
      name: 'Archival close reading',
      design:
        'Folio-by-folio close reading of the correspondence series against the archive finding aid.',
      paradigm: 'qualitative',
      sampling:
        'The complete surviving correspondence series for 1871-1879 held in the diocesan archive.',
      instruments: ['transcription protocol', 'coding scheme for founding attributions'],
      analysis: [
        'thematic coding of founding attributions',
        'triangulation against the printed histories',
      ],
      limitations: [
        'one archive',
        'correspondence survives unevenly',
        'no subscription list located',
      ],
      questions: [rq1.id],
    });

    const { obj: evSchoolmaster } = await addEntity(deps, 'evidence', {
      source: artEarlier,
      locator: 'box 4, folio 18',
      excerpt:
        'The catalogue "was drawn up by the schoolmaster himself, who founded our little society and kept its ledger until Michaelmas last."',
      strength: 'moderate',
    });
    const { obj: evMerchants } = await addEntity(deps, 'evidence', {
      source: artLater,
      locator: 'box 5, folio 3',
      excerpt:
        'The society "was got up by the subscribing merchants of the quay, who put their names to the first list before ever the schoolmaster was applied to."',
      strength: 'moderate',
    });
    const { obj: evMonograph } = await addEntity(deps, 'evidence', {
      source: srcMonograph.id,
      locator: 'p. 118',
      excerpt:
        'Provincial reading societies of the 1870s were, as a rule, got up by subscribing tradesmen rather than by clergy or schoolmasters.',
      strength: 'weak',
    });
    // Cites the correspondence series by its SRC id, which is what puts it in the registry.
    await addEntity(deps, 'evidence', {
      source: srcPapers.id,
      locator: 'series description',
      excerpt:
        'The correspondence series preserves letters exchanged between the officers of the society between 1871 and 1879.',
      strength: 'moderate',
    });

    const { obj: claimContested } = await addEntity(deps, 'claim', {
      statement:
        'The Devane correspondence attributes the founding of the reading society to two different parties within nine months.',
      kind: 'empirical',
      supported_by: [evSchoolmaster.id, evMerchants.id],
      questions: [rq1.id],
      sections: ['Introduction', 'Discussion'],
    });
    await promote(deps, claimContested.id, { to: 'supported' });

    // Rests on weak evidence only - `claim-weak-evidence`.
    await addEntity(deps, 'claim', {
      statement:
        'Provincial reading societies of the period were ordinarily founded by subscribing tradesmen.',
      kind: 'literature',
      supported_by: [evMonograph.id],
      questions: [rq1.id],
      sections: ['Discussion'],
    });

    // The disputed pair: two readings of the same founding, each with its own folio behind it.
    const { obj: claimSchoolmaster } = await addEntity(deps, 'claim', {
      statement: 'The reading society was founded by the parish schoolmaster.',
      kind: 'empirical',
      supported_by: [evSchoolmaster.id],
    });
    const { obj: claimMerchants } = await addEntity(deps, 'claim', {
      statement: 'The reading society was founded by a committee of subscribing merchants.',
      kind: 'empirical',
      supported_by: [evMerchants.id],
    });
    await link(deps, claimSchoolmaster.id, { contradicts: claimMerchants.id });

    // One fact, and not a number: the knowledge layer records what a document says, and in this
    // field what it says is a shelfmark rather than a measurement.
    await addEntity(deps, 'fact', {
      key: 'archive_reference',
      value: 'Devane papers, box 4, folio 18',
      from: { artifact: artEarlier, locator: 'Provenance' },
    });

    await acceptCandidate(
      deps,
      await recordSearch(deps, {
        query: 'provincial reading societies subscription lists',
        question: rq1.id,
        at: '2025-02-01T00:00:00Z',
        provider: 'openalex',
        routes: [{ match: 'api.openalex.org', body: HUMANITIES_OPENALEX_RESPONSE }],
      }),
    );

    await addAuthorProfile(deps, root, RESEARCHER_D_PROFILE, RESEARCHER_D_SAMPLE);

    // The decision the dispute needs, proposed and left open: which folio to prefer is an
    // argument a historian makes in the text, not something a tool settles by ranking evidence.
    await propose(deps, {
      title: 'Resolve the disputed attribution of the founding',
      rationale:
        'The May 1873 letter credits the schoolmaster and the February 1874 letter the ' +
        'subscribing merchants. Preferring either requires the first subscription list, which ' +
        'both letters refer to and which has not been located in the series.',
      affects: [claimSchoolmaster.id, claimMerchants.id],
      change: {
        resolves_contradiction: [claimSchoolmaster.id, claimMerchants.id],
        survivor: claimMerchants.id,
      },
    });

    await writeIntroduction(deps, {
      voice: RESEARCHER_D_PROFILE.id,
      draft: humanitiesDraft(claimContested),
      revised: humanitiesRevised(claimContested),
      title: 'Approve the introduction as revised',
      rationale:
        'The section asserts one supported claim with both folios behind it, and the revision ' +
        'replaced the appeal to the literature with what the two letters actually say.',
    });

    await packs.apply(deps, 'humanities');
    await packs.apply(deps, 'qualitative');
    await packs.apply(deps, 'generic-thesis');
    await profile.use(deps, 'generic-thesis');

    await recordReview(deps, 'reviewer2', [
      {
        target: claimContested.id,
        severity: 'major',
        message:
          'Both attributions rest on a single surviving witness written years after the events, ' +
          'and the endorsement on the later letter is undated, so the chapter should say what ' +
          'would have to be found before either reading could be preferred.',
        evidence: [evSchoolmaster.id, evMerchants.id],
        suggested_command: `phdude decide propose --title "State the evidential standard for the founding attribution" --affects ${method.id}`,
      },
    ]);
  },
};

export const PROFILES = [quantitativeSocialScience, machineLearning, qualitativeHumanities];

export async function generate(name, root) {
  const found = PROFILES.find((entry) => entry.name === name);
  if (!found) {
    throw new Error(`unknown example ${name}; known: ${PROFILES.map((p) => p.name).join(', ')}`);
  }
  await buildExample(root, found);
}

async function main() {
  const asked = process.argv.slice(2);
  const wanted = asked.length === 0 ? PROFILES.map((p) => p.name) : asked;
  for (const name of wanted) {
    const root = join(EXAMPLES_DIR, name);
    await generate(name, root);
    console.log(`generated ${root}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
