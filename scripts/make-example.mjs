#!/usr/bin/env node
// Regenerates examples/generic-thesis/ by driving the real use cases (initWorkspace, ingest,
// addEntity, decide.propose, promote) against a fixed clock, so the committed workspace is a
// faithful, reproducible sample rather than hand-authored YAML.
import { rm, utimes } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../src/adapters/store/fs-store.js';
import { walk, read, realpath } from '../src/adapters/store/fs-walk.js';
import { detectKind, parserFor } from '../src/adapters/documents/index.js';
import { discoverSkills } from '../src/adapters/skills/loader.js';
import { initWorkspace } from '../src/application/init.js';
import { ingest } from '../src/application/ingest.js';
import { addEntity } from '../src/application/add.js';
import { promote, propose } from '../src/application/decide.js';
import { link } from '../src/application/link.js';
import * as research from '../src/application/research.js';
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

export async function generate(root) {
  await rm(root, { recursive: true, force: true });

  const clock = makeClock();
  const deps = { store: new FsStore(root), clock, actor: ACTOR };

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

  await addEntity(deps, 'method', {
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
    sections: ['Results'],
  });
  await promote(deps, claim1.id, { to: 'supported' });

  await addEntity(deps, 'claim', {
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

  await propose(deps, {
    title: 'Resolve sample_size discrepancy between Survey Alpha/Gamma and Survey Beta',
    rationale:
      'Survey Alpha and Survey Gamma report 312 participants while Survey Beta reports 300; ' +
      'reconcile before citing a canonical sample size.',
    affects: [fact1.id, fact2.id, fact3.id],
    change: { fact_key: 'sample_size', canonical_value: 312 },
  });
}

async function main() {
  await generate(ROOT);
  console.log(`generated ${ROOT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
