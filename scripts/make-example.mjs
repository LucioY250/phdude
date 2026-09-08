#!/usr/bin/env node
// Regenerates examples/generic-thesis/ by driving the real use cases (initWorkspace, ingest,
// addEntity, decide.propose, promote) against a fixed clock, so the committed workspace is a
// faithful, reproducible sample rather than hand-authored YAML.
import { readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../src/adapters/store/fs-store.js';
import { walk, read, realpath } from '../src/adapters/store/fs-walk.js';
import { detectKind, parseTable, parserFor } from '../src/adapters/documents/index.js';
import { DEFAULT_PACKS_DIR, discoverPacks, loadProfile } from '../src/adapters/packs/loader.js';
import { discoverSkills, loadSkill } from '../src/adapters/skills/loader.js';
import { localRunner } from '../src/adapters/execution/local.js';
import { DEFAULT_GENERATORS_DIR } from '../src/adapters/execution/generators.js';
import { initWorkspace } from '../src/application/init.js';
import { ingest } from '../src/application/ingest.js';
import { addEntity } from '../src/application/add.js';
import { approve as approveDecision, promote, propose } from '../src/application/decide.js';
import { link } from '../src/application/link.js';
import * as analyze from '../src/application/analyze.js';
import * as authors from '../src/application/authors.js';
import * as data from '../src/application/data.js';
import * as figure from '../src/application/figure.js';
import * as research from '../src/application/research.js';
import * as review from '../src/application/review.js';
import * as manuscript from '../src/application/manuscript.js';
import * as packs from '../src/application/packs.js';
import * as profile from '../src/application/profile.js';
import * as prose from '../src/application/prose.js';
import * as table from '../src/application/table.js';
import { buildProviders } from '../src/adapters/search/index.js';
import { fakeFetch } from '../src/adapters/search/fake-fetch.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(PACKAGE_ROOT, 'examples', 'generic-thesis');

const ACTOR = { researcher: 'example', agent: 'script' };

// Only ever seen by a provider's User-Agent header, and the stubbed fetch below ignores it; a
// fixed string keeps the generator's output independent of the package version.
const EXAMPLE_VERSION = 'example';

// A fixed clock, advancing 1s per call, so every timestamp the generator writes is stable
// across regenerations - the whole point of this script being safe to diff or re-run in CI.
function makeClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 8, 1, 0, 0, tick++)).toISOString();
}

// A stub git adapter: examples/generic-thesis lives inside PhDude's own repository already, so
// isInsideRepo reports true and initWorkspace never touches git for real.
const fakeGit = {
  isInsideRepo: async () => true,
  initRepo: async () => {
    throw new Error('fakeGit.initRepo should never be called (isInsideRepo already reports true)');
  },
  userName: async () => 'example',
};

const SOURCE_FILES = {
  'sources/survey-alpha.md': `# Survey Alpha

## Methods

We surveyed 312 undergraduate students about their use of mobile note-taking apps during
lectures, recruited through the university's main mailing list.

## Results

Most respondents reported daily use of at least one note-taking application.
`,
  'sources/survey-beta.md': `# Survey Beta

## Methods

An independent survey of 300 undergraduate students examined the same question using a
different recruitment channel (a campus social media group).

## Results

Reported daily use was slightly lower than in Survey Alpha.
`,
  'sources/survey-gamma.md': `# Survey Gamma

## Methods

A third, unaffiliated survey of 312 undergraduate students corroborates the Survey Alpha
sample size, using stratified sampling across three campuses.

## Results

Findings are broadly consistent with Survey Alpha.
`,
  'sources/participants.csv': `metric,value\ncountry,Peru\n`,
  // Classified below as `notes`, and deliberately never mined: no source, fact or evidence
  // points at it, which is the `artifact-unmined` gap.
  'sources/lab-notebook.md': `# Reading notes

Loose notes taken while reading the three surveys. Nothing here has been turned into a source,
a fact or an evidence item yet.
`,
};

// The one dataset the example carries: twenty synthetic respondents, three recruitment
// channels, one yes/no answer. Small enough to read in the diff, and shaped so the analysis over
// it has something to say about the research question the example already asks.
const SURVEY_CSV =
  [
    'respondent_id,campus,recruitment_channel,daily_use',
    'R01,North,mailing list,yes',
    'R02,North,mailing list,yes',
    'R03,North,mailing list,yes',
    'R04,South,mailing list,no',
    'R05,South,mailing list,yes',
    'R06,South,mailing list,yes',
    'R07,East,mailing list,no',
    'R08,East,mailing list,yes',
    'R09,North,campus social media,yes',
    'R10,North,campus social media,no',
    'R11,South,campus social media,yes',
    'R12,South,campus social media,no',
    'R13,East,campus social media,no',
    'R14,East,campus social media,yes',
    'R15,North,stratified campuses,yes',
    'R16,North,stratified campuses,yes',
    'R17,South,stratified campuses,no',
    'R18,South,stratified campuses,yes',
    'R19,East,stratified campuses,yes',
    'R20,East,stratified campuses,yes',
  ].join('\n') + '\n';

// The analysis the example runs, committed under analysis/ exactly as a researcher would commit
// theirs. Plain Node, no dependencies, no network, and the same numbers out for the same file
// in - which is what lets `phdude repro check` say anything meaningful about it.
const ANALYSIS_SCRIPT = `#!/usr/bin/env node
// Reads data/survey.csv and reports daily note-taking app use per recruitment channel.
// PhDude runs this through \`phdude analyze run\`; it is never run by hand.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = 'analysis/out/survey-descriptives/results.json';

const text = await readFile('data/survey.csv', 'utf8');
const [header, ...body] = text
  .trim()
  .split('\\n')
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
  ) + '\\n',
);
`;

const FIGURE_ALT =
  'Bar chart: the mailing list contributed 8 of the 20 respondents; the campus social media ' +
  'group and the stratified campus sample contributed 6 each.';

const RESEARCHER_A_PROFILE = {
  id: 'researcher-a',
  name: 'Researcher A',
  language: 'en',
  tone: { academic: true, assertiveness: 'moderate', first_person: 'sparing' },
  sentences: { length: 'varied', openings: 'varied' },
  paragraphs: { density: 'medium' },
  transitions: 'minimal',
  terminology: {
    preserve: ['note-taking application', 'recruitment channel'],
    avoid: ['leverage', 'robust', 'cutting-edge'],
  },
};

// An approved writing sample in researcher-a's voice, about the example's own topic, so
// `phdude authors learn` has real prose to compute descriptive statistics from.
const RESEARCHER_A_SAMPLE = `Across three independently recruited undergraduate cohorts, adoption of mobile \
note-taking applications is remarkably consistent once recruitment channel is taken into \
account. Participants drawn from a general mailing list reported somewhat higher daily use \
than those recruited through a narrower campus social media group, and this pattern recurs \
whether the comparison is limited to two samples or extended across all three.

Stratified sampling across additional campuses corroborates the original estimate rather than \
undermining it. The third survey, recruited independently of the first two, reproduces a \
similar adoption rate under a sampling design meant specifically to test whether the earlier \
finding generalized beyond a single recruitment channel. Prior survey work has typically \
treated recruitment channel as incidental to note-taking application adoption; the pattern \
observed here suggests that channel deserves more explicit attention in future study designs, \
particularly where samples are compared across institutions rather than within one.

We report these figures descriptively rather than as evidence of a causal mechanism. A survey \
conducted at three points in time, with three distinct recruitment channels, cannot on its own \
distinguish a channel effect from an unmeasured cohort difference. The sample sizes involved \
here are modest, and the claim that follows from them is correspondingly narrow: recruitment \
channel is associated with the reported adoption rate, not that it determines it.`;

// DOS/FAT timestamps aside, a plain fixed mtime keeps ingest's artifact.mtime field (and hence
// the written YAML) stable across regenerations, independent of when this script happens to run.
const FIXED_MTIME = new Date('2026-08-15T00:00:00Z');

async function writeSources(store) {
  for (const [relPath, text] of Object.entries(SOURCE_FILES)) {
    await store.writeTextAtomic(relPath, text);
    await utimes(join(store.root, relPath), FIXED_MTIME, FIXED_MTIME);
  }
}

function artifactIdFor(artifacts, relPath) {
  const found = artifacts.find((a) => a.paths.includes(relPath));
  if (!found) throw new Error(`artifact not found for ${relPath}`);
  return found.id;
}

// OpenAlex ships abstracts as a word -> positions index for copyright reasons, so a stubbed
// response has to speak the same shape the real adapter reads.
function invertedAbstract(text) {
  const index = {};
  text.split(' ').forEach((word, position) => {
    (index[word] ??= []).push(position);
  });
  return index;
}

// One stubbed provider response. Nothing here reaches the network: `fakeFetch` answers the
// adapter's request from this object, which is what lets the example carry a real recorded
// search without the generator ever being online.
const OPENALEX_RESPONSE = {
  results: [
    {
      id: 'https://openalex.org/W4390110022',
      doi: 'https://doi.org/10.1234/jetr.2024.0142',
      display_name: 'Note-Taking Application Adoption Among Undergraduates: A Multi-Campus Survey',
      publication_year: 2024,
      language: 'en',
      type: 'article',
      primary_location: {
        landing_page_url: 'https://example.org/articles/multi-campus-note-taking',
        source: { display_name: 'Journal of Educational Technology Research' },
      },
      open_access: { is_oa: true },
      cited_by_count: 37,
      authorships: [
        { author: { display_name: 'F. Zeta' } },
        { author: { display_name: 'G. Eta' } },
      ],
      abstract_inverted_index: invertedAbstract(
        'Across four campuses we compare self-reported adoption of note-taking applications ' +
          'and find that recruitment channel explains most of the variance between samples.',
      ),
    },
    {
      id: 'https://openalex.org/W4312884501',
      doi: null,
      display_name: 'Self-Reported Versus Logged Use of Note-Taking Applications',
      publication_year: 2023,
      language: 'en',
      type: 'preprint',
      primary_location: {
        landing_page_url: 'https://example.org/preprints/self-reported-versus-logged',
        source: { display_name: 'Open Education Preprints' },
      },
      open_access: { is_oa: true },
      cited_by_count: 4,
      authorships: [{ author: { display_name: 'H. Theta' } }],
    },
  ],
};

// A literature search recorded a year before the rest of the example, so the workspace carries
// what a real one carries after a while: a queue of candidates nobody has ruled on yet, and a
// search old enough that `phdude gaps` and `phdude next` both call it stale. The clock is wound
// back deliberately - a search dated the same day as everything else would never age.
async function recordStaleSearch(deps, questionId) {
  const fetch = fakeFetch([{ match: 'api.openalex.org', body: OPENALEX_RESPONSE }]);
  const { candidates } = await research.search(
    {
      ...deps,
      clock: () => '2025-06-01T00:00:00Z',
      providers: buildProviders(['openalex'], { fetch, env: {}, version: EXAMPLE_VERSION }),
    },
    {
      query: 'note-taking app adoption undergraduates',
      question: questionId,
      allowNetwork: true,
    },
  );
  return candidates.created;
}

// One of the two candidates has been reviewed and accepted; the other is still waiting. That
// is what a real queue looks like, and it is what puts a source in the registry that was found
// rather than ingested - `phdude cite list` shows it, `phdude knowledge trace` shows where it
// came from. The preprint is deliberately left pending: the policy requires approval for one.
async function acceptOneCandidate(deps, candidateIds) {
  for (const id of candidateIds) {
    const candidate = await deps.store.readEntity(id);
    if (candidate.type !== 'article') continue;
    return research.accept(deps, id);
  }
  throw new Error('no article candidate to accept');
}

// The first paragraph asserts the one supported claim in the workspace, with the marker and
// the citation key the writing context would have handed an agent. The middle paragraph is the
// filler a model reaches for when it has nothing to say: an appeal to "the literature" with
// nobody cited, an intensifier standing in for a number, and a phrase that could be deleted
// whole. `phdude deslop introduction` reports all three.
function draftIntroduction(claim) {
  return [
    'Undergraduates report using note-taking applications daily, and the pattern holds across',
    'three independently recruited samples [@alpha2025survey].',
    `<!-- claim: ${claim.id} -->`,
    '',
    'It is important to note that the literature suggests adoption of these tools is significant',
    'across institutions.',
    '',
    'How far that generalises is the open question. The three surveys recruited through different',
    'channels, and the sample sizes they report do not agree, so this thesis asks whether adoption',
    'differs by recruitment channel and campus.',
  ].join('\n');
}

// The revision the deslop contract asks for: the middle paragraph now says something the
// workspace can back, and the claim marker, the citation and the negations `gate-meaning`
// watches all survive it.
function revisedIntroduction(claim) {
  return [
    'Undergraduates report using note-taking applications daily, and the pattern holds across',
    'three independently recruited samples [@alpha2025survey].',
    `<!-- claim: ${claim.id} -->`,
    '',
    'The three surveys did not recruit the same way: one used the university mailing list, one a',
    'campus social media group, and one a stratified sample across three campuses.',
    '',
    'How far the pattern generalises is therefore the open question. The sample sizes the three',
    'surveys report do not agree either, so this thesis asks whether adoption differs by',
    'recruitment channel and campus.',
  ].join('\n');
}

async function submitDraft(deps, body, options) {
  const path = join(deps.store.root, 'draft-introduction.md');
  await writeFile(path, body + '\n');
  await manuscript.submit(
    { ...deps, readText: () => readFile(path, 'utf8') },
    { section: 'introduction', file: path, ...options },
  );
  await rm(path);
}

// One recorded review, so the example carries the v0.7 loop and not only its commands: a
// methodologist's finding about the sampling frame, at `major`, still open. `phdude next` ranks
// it, `phdude health` charges Methodological Integrity for it, and `phdude ready` leaves it out
// of the blocking list because a `major` finding only blocks under `ruthless`.
async function recordMethodologyReview(deps, method, evidence) {
  const path = join(deps.store.root, 'findings.json');
  await writeFile(
    path,
    JSON.stringify(
      {
        findings: [
          {
            target: method.id,
            severity: 'major',
            message:
              'The three samples were recruited through different channels and the design ' +
              'records no stratification or weighting, so the pooled adoption rate cannot be ' +
              'read as an estimate for the student population.',
            evidence: evidence.map((item) => item.id),
            suggested_command: `phdude decide propose --title "Weight the pooled adoption rate by recruitment channel" --affects ${method.id}`,
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  await review.submit(
    { ...deps, readText: () => readFile(path, 'utf8') },
    {
      file: path,
      kind: 'methodology',
    },
  );
  await rm(path);
}

// The manuscript, so the example carries a section that went through the whole writing loop
// rather than one step of it: a planned six-section plan, an introduction submitted as a draft,
// the same section revised once with its filler removed, the prose report `phdude prose`
// stores, and finally an approval with a decision behind it - the human-authority gate, which
// is the only way a section reaches `approved`.
async function writeIntroduction(deps, claim) {
  // The manuscript names researcher-a as its voice, which is what makes the profile above more
  // than decoration: `phdude write` reads it into the writing context, and the voice check
  // compares a draft against its learned statistics.
  await manuscript.init(deps, { language: 'en', voice: RESEARCHER_A_PROFILE.id });

  await submitDraft(deps, draftIntroduction(claim));
  await submitDraft(deps, revisedIntroduction(claim), { revision: true });

  await prose.proseSection(deps, 'introduction');

  const { obj: decision } = await propose(deps, {
    title: 'Approve the introduction as revised',
    rationale:
      'The section asserts one supported claim with the evidence and citation behind it, and ' +
      'the revision passed every writing gate with no findings.',
    affects: ['manuscript:introduction'],
  });
  await approveDecision(deps, decision.id, { by: ACTOR.researcher });
  await manuscript.approve(deps, { section: 'introduction', decision: decision.id });
}

// One author profile, learned from one approved sample - `phdude authors learn`'s paths are
// resolved relative to the current directory, so this mirrors the CLI's own resolution rather
// than `store.readText` (workspace-root-relative).
async function addAuthorProfile(deps, root) {
  await authors.add(deps, RESEARCHER_A_PROFILE);

  const samplePath = join('authors', 'samples', 'researcher-a', 'intro-approved.md');
  await deps.store.writeTextAtomic(samplePath, RESEARCHER_A_SAMPLE);

  await authors.learn(
    { ...deps, cwd: root, readText: (p) => readFile(resolve(root, p), 'utf8') },
    RESEARCHER_A_PROFILE.id,
    { paths: [samplePath], approved: true },
  );
}

// Two things about a real run cannot be committed: which `node` happens to be on PATH, and how
// long the script took. The example's policy stays closed (`execution.enabled: false`) and names
// `node` like every other workspace; the generator pins the run to this process's own executable
// and its duration to zero, so regenerating produces the same bytes on any machine.
const pinnedRunner = {
  name: localRunner.name,
  available: (runtime) => localRunner.available(runtime),
  run: async (options) => {
    const result = await localRunner.run({ ...options, runtime: process.execPath });
    return { ...result, durationMs: 0 };
  },
};

// The v0.5 half of the example: a registered dataset, an analysis run under the execution
// policy, the two RESULTs it reported, a table over one of them and a figure drawn from the
// other, plus the evidence that carries a result into the argument. `phdude repro check` reads
// all of it and finds nothing to do, which is the state a finished chapter is supposed to be in.
async function analyseTheSurvey(deps, claim) {
  await deps.store.writeTextAtomic('data/survey.csv', SURVEY_CSV);
  await deps.store.writeTextAtomic('analysis/describe.mjs', ANALYSIS_SCRIPT);

  const { dataset } = await data.add(deps, 'data/survey.csv');

  const { analysis } = await analyze.add(deps, {
    name: 'survey descriptives',
    runtime: 'node',
    script: 'analysis/describe.mjs',
    inputs: [dataset.id],
  });
  const run = await analyze.run(deps, { id: analysis.id, allowExec: true });
  const byKey = (key) => run.created.find((r) => r.ext.analysis.key === key);
  const share = byKey('daily_use_by_channel');
  const respondents = byKey('respondents_by_channel');

  const declared = await table.add(deps, {
    name: 'daily-use-by-channel',
    caption: 'Reported daily use of a note-taking application, by recruitment channel.',
    source: { result: share.id },
    columns: [
      { key: 'key', label: 'Recruitment channel' },
      { key: 'value', label: 'Daily use', format: 'percent:0' },
    ],
  });
  await table.build(deps, declared.table.id);

  const drawn = await figure.add(deps, {
    name: 'respondents-by-channel',
    caption: 'Respondents by recruitment channel.',
    alt: FIGURE_ALT,
    generator: {
      runtime: 'node',
      script: 'phdude:bar-chart',
      args: [
        '--input',
        'analysis/out/survey-descriptives/results.json',
        '--key',
        'respondents_by_channel',
        '--out',
        'figures/out/respondents-by-channel.svg',
        '--title',
        'Respondents by recruitment channel',
        '--alt',
        FIGURE_ALT,
      ],
    },
    inputs: [respondents.id],
    outputs: [{ path: 'figures/out/respondents-by-channel.svg', format: 'svg' }],
  });
  await figure.build(deps, drawn.figure.id, { allowExec: true });

  // The lineage spec §3.3 asks for, end to end: DATASET → ANALYSIS → RESULT → evidence → claim.
  // The other result is deliberately left uncited, which is the `result-uncited` gap.
  const { obj: evidence } = await addEntity(deps, 'evidence', {
    source: share.id,
    locator: 'daily_use_by_channel',
    excerpt:
      'Daily use is reported by 75% of the mailing-list sample, 50% of the campus social media ' +
      'sample and 83% of the stratified campus sample.',
    strength: 'moderate',
  });
  await link(deps, claim.id, { to: [evidence.id] });
}

export async function generate(root) {
  await rm(root, { recursive: true, force: true });

  const clock = makeClock();
  const deps = {
    store: new FsStore(root),
    clock,
    actor: ACTOR,
    loadPacks: () => discoverPacks([DEFAULT_PACKS_DIR]),
    loadProfile: (name) => loadProfile(name),
    loadSkill,
  };

  await initWorkspace(
    { ...deps, git: fakeGit, agentHosts: [], discoverSkills },
    { title: 'Generic Thesis Example', agents: [], noGit: false },
  );

  await writeSources(deps.store);

  const { artifacts } = await ingest(
    { ...deps, fs: { walk, read, realpath }, parsers: { detectKind, parserFor } },
    { paths: ['sources'] },
  );

  const artAlpha = artifactIdFor(artifacts, 'sources/survey-alpha.md');
  const artBeta = artifactIdFor(artifacts, 'sources/survey-beta.md');
  const artGamma = artifactIdFor(artifacts, 'sources/survey-gamma.md');
  const artCsv = artifactIdFor(artifacts, 'sources/participants.csv');
  const artNotes = artifactIdFor(artifacts, 'sources/lab-notebook.md');

  // Classifying an artifact is bootstrap's first step, and it is what separates an unclassified
  // file from one that is classified but never mined (`phdude gaps`' `artifact-unmined`).
  await addEntity(deps, 'artifact-role', { id: artNotes, role: 'notes' });

  const { obj: source1 } = await addEntity(deps, 'source', {
    title: 'Survey Alpha and Beta: Note-Taking App Adoption',
    authors: ['A. Alpha', 'B. Beta'],
    year: 2025,
    type: 'report',
    artifacts: [artAlpha, artBeta],
  });
  const { obj: source2 } = await addEntity(deps, 'source', {
    title: 'Survey Gamma: Cross-Campus Replication',
    authors: ['C. Gamma'],
    year: 2025,
    type: 'report',
    artifacts: [artGamma],
  });
  // A second cited source, with a DOI - not backed by an ingested artifact of its own, which
  // is a normal state for a source you know about and cite before you have ingested its file.
  const { obj: source3 } = await addEntity(deps, 'source', {
    title: 'Cross-Institutional Meta-Analysis of Note-Taking App Adoption',
    authors: ['D. Delta'],
    year: 2024,
    venue: 'Journal of Educational Technology Research',
    type: 'article',
    identifiers: { doi: '10.1234/jetr.2024.0099' },
    artifacts: [],
  });
  // A third source, never cited by any evidence - exercises `cite check`'s informational
  // `uncited-source` finding (it does not fail the check on its own).
  await addEntity(deps, 'source', {
    title: 'Longitudinal Trends in Student Mobile Device Usage',
    authors: ['E. Epsilon'],
    year: 2023,
    type: 'preprint',
    artifacts: [],
  });

  const { obj: rq } = await addEntity(deps, 'question', {
    text: 'Does mobile note-taking app adoption differ across recruitment channels and campuses?',
    objectives: ['Compare adoption rates across independently recruited student surveys.'],
  });
  // No claim addresses this question and no method covers it - `phdude gaps` reports both
  // `question-without-claims` and `question-without-method` for it.
  const { obj: rq2 } = await addEntity(deps, 'question', {
    text: 'Does note-taking app adoption correlate with academic performance?',
    objectives: ['Assess correlation between reported app usage and course outcomes.'],
  });
  // Exactly one claim addresses this question, and it is still `candidate` - the
  // `question-only-candidates` gap. The method below covers it, so that is the only gap it has.
  const { obj: rq3 } = await addEntity(deps, 'question', {
    text: 'How consistent are reported adoption rates across institutions?',
    objectives: ['Compare adoption estimates reported by independent institutions.'],
  });

  // No claim addresses RQ-2, so nothing tests this hypothesis - `hypothesis-untested`.
  await addEntity(deps, 'hypothesis', {
    text: 'Students who report heavier note-taking app use also report better course outcomes.',
    questions: [rq2.id],
  });

  const { obj: method } = await addEntity(deps, 'method', {
    name: 'Cross-sectional survey',
    design: 'Three independently recruited undergraduate samples, one wave each.',
    paradigm: 'quantitative',
    sampling: 'Mailing list, campus social media group, and stratified campus sampling.',
    instruments: ['note-taking app adoption questionnaire'],
    analysis: ['descriptive comparison of reported daily use'],
    limitations: ['self-reported use', 'one university system'],
    questions: [rq.id, rq3.id],
  });

  const { obj: evidence1 } = await addEntity(deps, 'evidence', {
    source: artAlpha,
    locator: 'Methods',
    excerpt:
      '312 undergraduate students reported daily use of at least one note-taking application (Survey Alpha).',
    strength: 'moderate',
  });

  // Cites a SRC id directly (rather than an artifact) - the citation registry (`phdude cite
  // list|check|export`) counts a source as cited only by an evidence item recorded this way.
  await addEntity(deps, 'evidence', {
    source: source1.id,
    locator: 'Introduction',
    excerpt:
      'The combined report synthesizes note-taking app adoption findings across two independently recruited undergraduate samples.',
    strength: 'weak',
  });
  const { obj: evidence3 } = await addEntity(deps, 'evidence', {
    source: source3.id,
    locator: 'Abstract',
    excerpt:
      'A cross-institutional meta-analysis corroborates high daily adoption of note-taking applications among undergraduates.',
    strength: 'moderate',
  });
  // Weak-strength evidence citing source2 directly, for a claim addressing RQ-1 -
  // `phdude gaps`' `claim-weak-evidence` gap fires once every evidence item supporting a claim
  // is `weak`, and the matrix (`phdude matrix`) shows source2 reaching RQ-1 through evidence
  // that is itself weak.
  const { obj: evidenceWeak } = await addEntity(deps, 'evidence', {
    source: source2.id,
    locator: 'Limitations',
    excerpt:
      'The authors note this cross-campus replication is preliminary and has not yet been independently verified.',
    strength: 'weak',
  });

  // Cites Survey Beta's artifact directly, so it is the second half of the contradiction below
  // and a second claim depending on a conflicting artifact.
  const { obj: evidenceBeta } = await addEntity(deps, 'evidence', {
    source: artBeta,
    locator: 'Results',
    excerpt: 'Reported daily use was slightly lower than in Survey Alpha (Survey Beta).',
    strength: 'moderate',
  });

  const { obj: claim1 } = await addEntity(deps, 'claim', {
    statement:
      'Daily use of mobile note-taking apps is common among surveyed undergraduate students.',
    kind: 'empirical',
    // Supported by evidence citing an artifact directly and evidence citing a formal source
    // directly - the matrix (`phdude matrix`) attributes this claim's question to source3 via
    // the latter, while source1's own citing evidence (above) is never attached to any claim.
    supported_by: [evidence1.id, evidence3.id],
    questions: [rq.id],
    // Named for both sections: the introduction previews the finding, the results report it.
    // `phdude write introduction` picks the claim up from here.
    sections: ['Introduction', 'Results'],
  });
  await promote(deps, claim1.id, { to: 'supported' });

  const { obj: claimChannel } = await addEntity(deps, 'claim', {
    statement: 'Note-taking app adoption may vary by recruitment channel.',
    kind: 'empirical',
  });
  await addEntity(deps, 'claim', {
    statement: 'Stratified sampling across campuses corroborates the observed adoption rate.',
    kind: 'methodological',
  });
  await addEntity(deps, 'claim', {
    statement: 'Cross-campus replication weakly corroborates the observed adoption rate.',
    kind: 'methodological',
    supported_by: [evidenceWeak.id],
    questions: [rq.id],
    sections: ['Discussion'],
  });

  // The only claim addressing RQ-3, and still `candidate` - `question-only-candidates`.
  await addEntity(deps, 'claim', {
    statement: 'Cross-institutional evidence points to consistently high adoption.',
    kind: 'literature',
    supported_by: [evidence3.id],
    questions: [rq3.id],
  });

  // Two claims that cannot both be true, each with its own moderate evidence. Recording the
  // contradiction moves both to `disputed` with no Decision (PRD S3.5), and they stay there:
  // resolving one is the researcher's call, and `phdude gaps` reports the open `disputed-pair`.
  const { obj: claimAgree } = await addEntity(deps, 'claim', {
    statement: 'Daily note-taking app use is comparable across all three surveyed samples.',
    kind: 'empirical',
    supported_by: [evidence1.id],
  });
  const { obj: claimDisagree } = await addEntity(deps, 'claim', {
    statement:
      'Daily note-taking app use is materially lower in the sample recruited through social media.',
    kind: 'empirical',
    supported_by: [evidenceBeta.id],
  });
  await link(deps, claimAgree.id, { contradicts: claimDisagree.id });

  // Fact ids are content-derived from `key + value + from.artifact` (see domain/ids.js), so
  // this is the PRD §38 pattern: 312 from Alpha, 300 from Beta, 312 from Gamma - three distinct
  // FACT records, one open conflict with two distinct values.
  const { obj: fact1 } = await addEntity(deps, 'fact', {
    key: 'sample_size',
    value: 312,
    unit: 'participants',
    from: { artifact: artAlpha, locator: 'Methods' },
  });
  const { obj: fact2 } = await addEntity(deps, 'fact', {
    key: 'sample_size',
    value: 300,
    unit: 'participants',
    from: { artifact: artBeta, locator: 'Methods' },
  });
  const { obj: fact3 } = await addEntity(deps, 'fact', {
    key: 'sample_size',
    value: 312,
    unit: 'participants',
    from: { artifact: artGamma, locator: 'Methods' },
  });
  await addEntity(deps, 'fact', {
    key: 'country',
    value: 'Peru',
    from: { artifact: artCsv, locator: 'row 2' },
  });

  await acceptOneCandidate(deps, await recordStaleSearch(deps, rq.id));

  await addAuthorProfile(deps, root);

  await propose(deps, {
    title: 'Resolve sample_size discrepancy between Survey Alpha/Gamma and Survey Beta',
    rationale:
      'Survey Alpha and Survey Gamma report 312 participants while Survey Beta reports 300; ' +
      'reconcile before citing a canonical sample size.',
    affects: [fact1.id, fact2.id, fact3.id],
    change: { fact_key: 'sample_size', canonical_value: 312 },
  });

  await writeIntroduction(deps, claim1);

  await analyseTheSurvey(
    {
      ...deps,
      runner: pinnedRunner,
      readBytes: (rel) => read(join(root, rel)),
      realpath,
      parseTable,
      generatorsDir: DEFAULT_GENERATORS_DIR,
    },
    claimChannel,
  );

  // The venue, last: choosing where the work goes is a decision, and it is the one that makes
  // `phdude profile check`, `phdude build` and `phdude adapt --to ieee` mean something on this
  // workspace. The project adopts the thesis venue pack; the manuscript targets it.
  await packs.apply(deps, 'generic-thesis');
  await profile.use(deps, 'generic-thesis');

  // The review last, because reviewing is what happens once there is something to review. It
  // stays open: accepting, dismissing or resolving a finding is the researcher's call, and an
  // example that had already made it would be showing the wrong half of the loop.
  await recordMethodologyReview(deps, method, [evidence1, evidenceBeta]);
}

async function main() {
  await generate(ROOT);
  console.log(`generated ${ROOT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
