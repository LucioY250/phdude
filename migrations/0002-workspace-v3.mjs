// Workspace 2 → 3: the execution policy a v0.5 reader expects to find, and the directories the
// analysis objects write into. Nothing here interprets content, so a re-run is a no-op.

const POLICY_PATH = '.phdude/research-policy.yaml';

// Kept in step with `defaults/research-policy.yaml` and with `DEFAULT_RUNTIMES` /
// `DEFAULT_EXECUTION_TIMEOUT_SECONDS` in src/domain/policy.js: what the migration writes is what
// a fresh `phdude init` writes, and both say the same thing the domain assumes when the keys are
// missing - closed, and these three runtimes.
const EXECUTION_DEFAULTS = {
  enabled: false,
  runtimes: { node: 'node', python3: 'python3', Rscript: 'Rscript' },
  timeout_seconds: 600,
};

const NEW_DIRS = ['knowledge/datasets', 'analysis/out', 'tables/out', 'figures/out'];

// Kept in step with `defaults/workspace.gitignore`. What an analysis, a table or a figure writes
// is a regenerable artefact, ignored the way `outputs/` already is, so a workspace does not start
// committing rendered output the day it gains the directories to write it into.
const IGNORE_RULES = [
  'analysis/out/*',
  '!analysis/out/.gitkeep',
  'tables/out/*',
  '!tables/out/.gitkeep',
  'figures/out/*',
  '!figures/out/.gitkeep',
];

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Only ever adds a key that is not there. A value the researcher wrote stays exactly as written,
// and a block they wrote as something other than a mapping is left alone rather than replaced -
// reading it is their business, and every one of these keys is absent-means-closed anyway.
function backfillPolicy(policy) {
  const patch = {};

  if (policy.execution === undefined) {
    patch.execution = EXECUTION_DEFAULTS;
  } else if (isMapping(policy.execution)) {
    const missing = Object.fromEntries(
      Object.entries(EXECUTION_DEFAULTS).filter(([key]) => policy.execution[key] === undefined),
    );
    if (Object.keys(missing).length > 0) patch.execution = { ...policy.execution, ...missing };
  }

  if (policy.skills === undefined) {
    patch.skills = { allow_network: false, allow_execution: false };
  } else if (isMapping(policy.skills) && policy.skills.allow_execution === undefined) {
    patch.skills = { ...policy.skills, allow_execution: false };
  }

  return Object.keys(patch).length > 0 ? { ...policy, ...patch } : null;
}

// Only the rules that are not there already, appended: the order and the comments a researcher
// gave their own file are theirs. A workspace with no `.gitignore` is one that decided against
// ignoring anything, and writing one now would be inventing a document rather than backfilling.
function backfillGitignore(existing) {
  if (typeof existing !== 'string') return null;
  const lines = existing.split('\n');
  const missing = IGNORE_RULES.filter((rule) => !lines.includes(rule));
  if (missing.length === 0) return null;
  const gap = existing === '' || existing.endsWith('\n') ? '' : '\n';
  return existing + gap + missing.join('\n') + '\n';
}

// The change list is computed before anything is written so `preview` and `apply` cannot
// disagree about what this step touches.
async function planChanges(store) {
  const changes = [];

  for (const dir of NEW_DIRS) {
    const path = `${dir}/.gitkeep`;
    if (!(await store.exists(path))) changes.push({ path, text: '' });
  }

  const gitignore = backfillGitignore(await store.readText('.gitignore'));
  if (gitignore !== null) changes.push({ path: '.gitignore', text: gitignore });

  // A workspace with no policy file is one the researcher never opened anything in; writing one
  // now would be inventing a document, not backfilling a shape.
  const policy = await store.readYaml(POLICY_PATH);
  if (isMapping(policy)) {
    const updated = backfillPolicy(policy);
    if (updated) changes.push({ path: POLICY_PATH, policy: updated });
  }

  const project = await store.readProject();
  if (project !== null && project.workspace_version !== 3) {
    changes.push({ path: 'phdude.yaml', project: { ...project, workspace_version: 3 } });
  }

  return changes;
}

export default {
  from: 2,
  to: 3,

  describe() {
    return 'add the execution policy keys and the dataset, analysis, table and figure directories';
  },

  /**
   * @param {object} store
   * @returns {Promise<string[]>} the workspace-relative paths this step would write
   */
  async preview(store) {
    return (await planChanges(store)).map((change) => change.path);
  },

  /**
   * @param {object} store
   * @returns {Promise<{changed: string[]}>}
   */
  async apply(store) {
    const changes = await planChanges(store);
    for (const change of changes) {
      if (change.text !== undefined) await store.writeTextAtomic(change.path, change.text);
      else if (change.policy) await store.writeYamlAtomic(change.path, change.policy);
      else await store.writeProject(change.project);
    }
    return { changed: changes.map((change) => change.path) };
  },
};
