// Workspace 4 → 5: the directory review objects live in, and the policy keys a v0.7 reader
// expects to find - what each health dimension is worth, and what `ready` requires before a
// manuscript may go out. Nothing here interprets content, so a re-run is a no-op.

const POLICY_PATH = '.phdude/research-policy.yaml';
const REVIEWS_KEEP = 'reviews/.gitkeep';

// Kept in step with `defaults/research-policy.yaml`: what the migration writes is what a fresh
// `phdude init` writes. The weights sum to 1.00 and are ordered by how much of the argument
// rests on each dimension - evidence first, prose last, because prose that reads well over
// evidence that does not hold is the failure mode PhDude exists to prevent.
const HEALTH_WEIGHTS = {
  literature_coverage: 0.15,
  evidence_strength: 0.2,
  methodological_integrity: 0.15,
  citation_quality: 0.15,
  freshness: 0.1,
  reproducibility: 0.1,
  consistency: 0.1,
  prose_quality: 0.05,
};

// What `phdude ready` refuses to sign off without (spec §3.4). Absent means the reader's own
// defaults apply, and these are those defaults written down.
const READY_DEFAULTS = {
  min_health: 70,
  require: [
    'no-open-conflicts',
    'no-disputed-pairs',
    'no-block-reviews',
    'all-sections-approved',
    'figures-alt',
    'repro-clean',
    'citations-clean',
  ],
};

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Only ever adds a key that is not there. A weight or a threshold the researcher chose stays
// exactly as chosen, and a block they wrote as something other than a mapping is left alone
// rather than replaced - reading it is their business.
function backfillPolicy(policy) {
  const patch = {};

  if (policy.health === undefined) {
    patch.health = { weights: HEALTH_WEIGHTS };
  } else if (isMapping(policy.health) && policy.health.weights === undefined) {
    patch.health = { ...policy.health, weights: HEALTH_WEIGHTS };
  }

  if (policy.ready === undefined) {
    patch.ready = READY_DEFAULTS;
  } else if (isMapping(policy.ready)) {
    const missing = Object.fromEntries(
      Object.entries(READY_DEFAULTS).filter(([key]) => policy.ready[key] === undefined),
    );
    if (Object.keys(missing).length > 0) patch.ready = { ...policy.ready, ...missing };
  }

  return Object.keys(patch).length > 0 ? { ...policy, ...patch } : null;
}

// The change list is computed before anything is written so `preview` and `apply` cannot
// disagree about what this step touches.
async function planChanges(store) {
  const changes = [];

  if (!(await store.exists(REVIEWS_KEEP))) changes.push({ path: REVIEWS_KEEP, text: '' });

  // A workspace with no policy file is one the researcher never opened anything in; writing one
  // now would be inventing a document, not backfilling a shape.
  const policy = await store.readYaml(POLICY_PATH);
  if (isMapping(policy)) {
    const updated = backfillPolicy(policy);
    if (updated) changes.push({ path: POLICY_PATH, policy: updated });
  }

  const project = await store.readProject();
  if (project !== null && project.workspace_version !== 5) {
    changes.push({ path: 'phdude.yaml', project: { ...project, workspace_version: 5 } });
  }

  return changes;
}

export default {
  from: 4,
  to: 5,

  describe() {
    return 'add the reviews directory and the health and readiness policy keys';
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
