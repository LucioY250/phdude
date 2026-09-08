import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FsStore } from '../../src/adapters/store/fs-store.js';
import { initWorkspace } from '../../src/application/init.js';
import { doctor } from '../../src/application/doctor.js';
import { discoverSkills, loadSkill } from '../../src/adapters/skills/loader.js';
import {
  gitCloner,
  readSkillSource,
  removeSkillDir,
  tempSkillDir,
  writeSkillTree,
} from '../../src/adapters/skills/install.js';
import { DEFAULT_SKILLS_DIR } from '../../src/adapters/agents/shared.js';
import { claudeCodeHost } from '../../src/adapters/agents/claude-code.js';
import { indexAgentSkills } from '../../src/application/init.js';
import { install, list, remove } from '../../src/application/skills.js';
import { PhdudeError } from '../../src/domain/errors.js';

const actor = { researcher: 'test', agent: 'node' };

const skillMd = ({
  name,
  description = `the ${name} skill`,
  network = 'none',
  execution = 'none',
  contract = true,
} = {}) =>
  [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    ...(contract
      ? [
          'phdude:',
          '  version: 1',
          '  reads: []',
          '  writes: []',
          '  permissions:',
          `    network: ${network}`,
          `    execution: ${execution}`,
          '    workspace: [read]',
        ]
      : []),
    '---',
    '',
    `# ${name}`,
    '',
  ].join('\n');

async function writeTree(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), text);
  }
  return dir;
}

async function sourceDir(t, files) {
  const dir = await mkdtemp(join(tmpdir(), 'phdude-skill-src-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return writeTree(dir, files);
}

async function newWorkspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'phdude-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let tick = 0;
  const clock = () => new Date(Date.UTC(2026, 8, 8, 0, 0, tick++)).toISOString();
  const store = new FsStore(root);
  await initWorkspace(
    {
      store,
      git: { isInsideRepo: async () => false, initRepo: async () => {}, userName: async () => 'x' },
      agentHosts: [],
      clock,
      actor,
      discoverSkills,
    },
    { title: 'Skills', agents: [], noGit: true },
  );
  return {
    root,
    store,
    deps: {
      store,
      discoverSkills,
      skillsDir: DEFAULT_SKILLS_DIR,
      loadSkill,
      readSkillSource,
      writeSkillTree,
      cloneSkill: gitCloner({ execFile: () => assert.fail('no clone expected') }),
      tempDir: tempSkillDir,
      removeDir: removeSkillDir,
      clock,
      actor,
    },
  };
}

async function skillEvents(store) {
  return (await store.readEvents()).filter((event) => event.op === 'skills');
}

test('install copies a skill directory in, locks its provenance and writes one event', async (t) => {
  const { root, store, deps } = await newWorkspace(t);
  const src = await sourceDir(t, {
    'SKILL.md': skillMd({ name: 'lab-checklist' }),
    'references/steps.md': '# steps\n',
  });

  const result = await install(deps, src);

  assert.equal(result.name, 'lab-checklist');
  assert.equal(result.source, src);
  assert.equal(result.replaced, false);
  assert.equal(result.files, 2);
  assert.match(result.hash, /^[0-9a-f]{64}$/);

  assert.equal(
    await readFile(
      join(root, '.phdude', 'skills', 'lab-checklist', 'references', 'steps.md'),
      'utf8',
    ),
    '# steps\n',
  );

  const lock = await store.readSkillsLock();
  assert.equal(lock.schema, 'phdude.skills-lock');
  assert.deepEqual(lock.skills, [
    { name: 'lab-checklist', source: src, hash: result.hash, installed_at: result.installed_at },
  ]);

  const events = await skillEvents(store);
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, `installed lab-checklist from ${src}`);
  assert.equal(events[0].ts, result.installed_at);
});

test('install refuses a skill whose purpose names detector evasion, and installs nothing', async (t) => {
  const { root, store, deps } = await newWorkspace(t);
  const src = await sourceDir(t, {
    'SKILL.md': skillMd({
      name: 'ghostwriter',
      description: 'Rewrite a draft for detector evasion before submission.',
    }),
  });

  await assert.rejects(install(deps, src), (err) => {
    assert.ok(err instanceof PhdudeError);
    assert.equal(err.code, 'POLICY');
    assert.match(err.message, /detector evasion/);
    assert.match(err.hint, /§30c/);
    return true;
  });

  assert.equal(await store.exists(join('.phdude', 'skills', 'ghostwriter')), false);
  assert.equal(await store.readSkillsLock(), null);
  assert.deepEqual(await skillEvents(store), []);
  assert.equal(await store.exists('.phdude/skills-lock.yaml'), false);
  assert.ok(root);
});

test('install refuses a humanizer by its name alone', async (t) => {
  const { deps } = await newWorkspace(t);
  const src = await sourceDir(t, { 'SKILL.md': skillMd({ name: 'humanizer' }) });
  await assert.rejects(install(deps, src), { code: 'POLICY' });
});

test('install refuses a skill whose contract does not validate, and leaves nothing behind', async (t) => {
  const { store, deps } = await newWorkspace(t);
  const src = await sourceDir(t, {
    'SKILL.md': [
      '---',
      'name: broken',
      'description: a skill with an invalid contract',
      'phdude:',
      '  version: 1',
      '  reads: []',
      '  writes: []',
      '  permissions:',
      '    network: sometimes',
      '    workspace: [read]',
      '---',
      '',
    ].join('\n'),
  });

  await assert.rejects(install(deps, src), { code: 'VALIDATION' });
  assert.equal(await store.exists(join('.phdude', 'skills', 'broken')), false);
  assert.deepEqual(await skillEvents(store), []);
});

test('install refuses a skill asking for a permission the research policy has not opened', async (t) => {
  const { store, deps } = await newWorkspace(t);
  const src = await sourceDir(t, {
    'SKILL.md': skillMd({ name: 'scraper', network: 'allowed' }),
  });

  await assert.rejects(install(deps, src), (err) => {
    assert.equal(err.code, 'POLICY');
    assert.equal(err.message, 'skill scraper requests network access');
    assert.equal(err.hint, 'set skills.allow_network: true in .phdude/research-policy.yaml');
    return true;
  });
  assert.equal(await store.exists(join('.phdude', 'skills', 'scraper')), false);
});

test('install accepts the same skill once the research policy opens the permission', async (t) => {
  const { store, deps } = await newWorkspace(t);
  await store.writeTextAtomic(
    join('.phdude', 'research-policy.yaml'),
    'skills:\n  allow_network: true\n',
  );
  const src = await sourceDir(t, { 'SKILL.md': skillMd({ name: 'scraper', network: 'allowed' }) });

  const result = await install(deps, src);
  assert.equal(result.name, 'scraper');
  assert.equal(await store.exists(join('.phdude', 'skills', 'scraper')), true);
});

test('install refuses a name PhDude ships', async (t) => {
  const { deps } = await newWorkspace(t);
  const src = await sourceDir(t, { 'SKILL.md': skillMd({ name: 'literature' }) });
  await assert.rejects(install(deps, src), {
    code: 'VALIDATION',
    message: 'literature is a skill PhDude ships',
  });
});

test('install refuses an already installed skill unless --force, which replaces every file', async (t) => {
  const { root, store, deps } = await newWorkspace(t);
  const first = await sourceDir(t, {
    'SKILL.md': skillMd({ name: 'lab-checklist' }),
    'references/old.md': 'old\n',
  });
  await install(deps, first);

  const second = await sourceDir(t, {
    'SKILL.md': skillMd({ name: 'lab-checklist', description: 'the revised checklist' }),
    'references/new.md': 'new\n',
  });

  await assert.rejects(install(deps, second), {
    code: 'VALIDATION',
    message: 'skill lab-checklist is already installed',
  });

  const result = await install(deps, second, { force: true });
  assert.equal(result.replaced, true);
  assert.equal(result.source, second);

  const installed = join(root, '.phdude', 'skills', 'lab-checklist');
  assert.equal(await readFile(join(installed, 'references', 'new.md'), 'utf8'), 'new\n');
  assert.equal(
    await store.exists(join('.phdude', 'skills', 'lab-checklist', 'references', 'old.md')),
    false,
  );

  const lock = await store.readSkillsLock();
  assert.equal(lock.skills.length, 1);
  assert.equal(lock.skills[0].hash, result.hash);
  assert.equal((await skillEvents(store)).length, 2);
});

test('install refuses a directory without a SKILL.md, and a symlink inside one', async (t) => {
  const { deps } = await newWorkspace(t);

  const empty = await sourceDir(t, { 'README.md': '# not a skill\n' });
  await assert.rejects(install(deps, empty), { code: 'VALIDATION' });

  const linked = await sourceDir(t, { 'SKILL.md': skillMd({ name: 'linked' }) });
  await symlink('/etc/hosts', join(linked, 'hosts.md'));
  await assert.rejects(install(deps, linked), {
    code: 'VALIDATION',
    message: 'symlink inside the skill directory: hosts.md',
  });

  await assert.rejects(install(deps, join(linked, 'nowhere')), { code: 'USAGE' });
});

test('install from a git URL needs the network policy, then clones and records the URL', async (t) => {
  const { store, deps } = await newWorkspace(t);
  const url = 'https://example.org/lab/prisma-screening.git';

  const calls = [];
  const fakeExecFile = (file, args, cb) => {
    calls.push([file, args]);
    writeTree(args[4], {
      'SKILL.md': skillMd({ name: 'prisma-screening' }),
      '.git/config': '[core]\n',
    }).then(
      () => cb(null, '', ''),
      (err) => cb(err, '', ''),
    );
  };
  const cloning = { ...deps, cloneSkill: gitCloner({ execFile: fakeExecFile }) };

  await assert.rejects(install(cloning, url), (err) => {
    assert.equal(err.code, 'POLICY');
    assert.equal(err.message, 'network access is disabled');
    return true;
  });
  assert.deepEqual(calls, [], 'nothing is cloned before the policy is checked');

  const result = await install(cloning, url, { allowNetwork: true });

  assert.deepEqual(calls[0][0], 'git');
  assert.deepEqual(calls[0][1].slice(0, 4), ['clone', '--depth', '1', url]);
  assert.equal(result.source, url);
  assert.equal(result.files, 1, "the clone's .git is not part of the skill");
  assert.equal(await store.exists(join('.phdude', 'skills', 'prisma-screening', '.git')), false);
  assert.equal((await store.readSkillsLock()).skills[0].source, url);
});

test('a failing clone is reported and installs nothing', async (t) => {
  const { store, deps } = await newWorkspace(t);
  const failing = {
    ...deps,
    cloneSkill: gitCloner({
      execFile: (file, args, cb) =>
        cb(
          Object.assign(new Error('exit 128'), { code: 128 }),
          '',
          'fatal: repository not found\n',
        ),
    }),
  };

  await assert.rejects(
    install(failing, 'https://example.org/lab/nope.git', { allowNetwork: true }),
    {
      code: 'EXECUTION',
      hint: 'fatal: repository not found',
    },
  );
  assert.deepEqual(await skillEvents(store), []);
});

test('remove deletes the skill and its lock entry, and refuses a shipped or unknown one', async (t) => {
  const { store, deps } = await newWorkspace(t);
  const src = await sourceDir(t, { 'SKILL.md': skillMd({ name: 'lab-checklist' }) });
  await install(deps, src);

  await assert.rejects(remove(deps, 'literature'), {
    code: 'VALIDATION',
    message: 'literature is a skill PhDude ships',
  });
  await assert.rejects(remove(deps, 'nowhere'), {
    code: 'USAGE',
    message: 'no skill named nowhere is installed',
  });

  const result = await remove(deps, 'lab-checklist');
  assert.equal(result.source, src);
  assert.equal(await store.exists(join('.phdude', 'skills', 'lab-checklist')), false);
  assert.deepEqual((await store.readSkillsLock()).skills, []);

  const events = await skillEvents(store);
  assert.equal(events.length, 2);
  assert.equal(events[1].summary, 'removed lab-checklist');
});

test('list marks an installed skill external, with its source and whether it was edited', async (t) => {
  const { root, store, deps } = await newWorkspace(t);
  const src = await sourceDir(t, { 'SKILL.md': skillMd({ name: 'lab-checklist' }) });
  await install(deps, src);

  const listDeps = {
    store,
    loadPacks: async () => [],
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
    readSkillSource,
  };

  const before = await list(listDeps);
  const entry = before.skills.find((skill) => skill.name === 'lab-checklist');
  assert.equal(entry.external, true);
  assert.equal(entry.origin, src);
  assert.equal(entry.drifted, false);
  assert.equal(before.skills.find((skill) => skill.name === 'literature').external, false);
  assert.equal(before.warnings.filter((w) => w.includes('lab-checklist')).length, 0);

  await writeFile(
    join(root, '.phdude', 'skills', 'lab-checklist', 'SKILL.md'),
    skillMd({ name: 'lab-checklist', description: 'edited by hand' }),
  );

  const after = await list(listDeps);
  assert.equal(after.skills.find((skill) => skill.name === 'lab-checklist').drifted, true);
  assert.ok(after.warnings.some((w) => /lab-checklist no longer matches the hash/.test(w)));
});

test('doctor reports an external skill with its source, and warns once its files change', async (t) => {
  const { root, store, deps } = await newWorkspace(t);
  const src = await sourceDir(t, { 'SKILL.md': skillMd({ name: 'lab-checklist' }) });
  await install(deps, src);

  const doctorDeps = {
    store,
    git: { isAvailable: async () => true },
    parsers: [],
    renderers: [],
    loadPacks: async () => [],
    schemaTypes: ['claim'],
    node: 'v22.0.0',
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
    readSkillSource,
  };

  const clean = await doctor(doctorDeps);
  assert.deepEqual(clean.externalSkills, [
    {
      name: 'lab-checklist',
      source: src,
      hash: (await store.readSkillsLock()).skills[0].hash,
      installed_at: (await store.readSkillsLock()).skills[0].installed_at,
      present: true,
      drifted: false,
    },
  ]);

  // Edited in place: the files are still there, they are no longer the ones that were locked.
  await writeFile(
    join(root, '.phdude', 'skills', 'lab-checklist', 'SKILL.md'),
    skillMd({ name: 'lab-checklist', description: 'edited after install' }),
  );
  const drifted = await doctor(doctorDeps);
  assert.equal(drifted.externalSkills[0].present, true);
  assert.equal(drifted.externalSkills[0].drifted, true);
  assert.ok(drifted.warnings.some((w) => /no longer matches the hash/.test(w)));

  await rm(join(root, '.phdude', 'skills', 'lab-checklist'), { recursive: true, force: true });
  const gone = await doctor(doctorDeps);
  assert.equal(gone.externalSkills[0].present, false);
  assert.equal(gone.externalSkills[0].drifted, false);
  assert.ok(gone.warnings.some((w) => /locked to .* but is not installed/.test(w)));
});

// docs/extending.md promises that a skill which *states* the prohibition - as the shipped
// `academic-prose` skill does - stays installable, because only the declared purpose is read.
// A later change that scanned bodies would pass every other test in this file and fail here.
test('a skill whose body states the no-humanizer rule installs; only the purpose is read', async (t) => {
  const { store, deps } = await newWorkspace(t);
  const src = await sourceDir(t, {
    'SKILL.md':
      skillMd({ name: 'lab-prose', description: 'House style for lab reports.' }) +
      [
        '',
        'Never rewrite a draft to humanize it or to move an AI-detector score: PhDude has no',
        'detector score and detection evasion is not a goal (PRD §30c).',
        '',
      ].join('\n'),
  });

  const result = await install(deps, src);

  assert.equal(result.name, 'lab-prose');
  assert.equal((await store.readSkillsLock()).skills[0].name, 'lab-prose');
});

test('an installed skill is indexed in the files the agent reads, and de-indexed on removal', async (t) => {
  const { root, store, deps } = await newWorkspace(t);
  const src = await sourceDir(t, {
    'SKILL.md': skillMd({ name: 'lab-checklist', description: 'The lab bench checklist.' }),
  });
  const project = await store.readProject();
  const agents = {
    store,
    agentHosts: [claudeCodeHost],
    discoverSkills,
    skillsDir: DEFAULT_SKILLS_DIR,
  };

  await store.writeProject({ ...project, agents: ['claude-code'] });
  await install(deps, src);
  await indexAgentSkills(agents);

  const indexed = await readFile(join(root, 'AGENTS.md'), 'utf8');
  assert.match(indexed, /- \*\*lab-checklist\*\* \(external\) - The lab bench checklist\./);
  assert.match(indexed, /-> \.phdude\/skills\/lab-checklist\/SKILL\.md/);
  assert.match(indexed, /- \*\*phdude-core\*\*|## Operating rules/);

  await remove(deps, 'lab-checklist');
  await indexAgentSkills(agents);

  assert.doesNotMatch(await readFile(join(root, 'AGENTS.md'), 'utf8'), /lab-checklist/);
});
