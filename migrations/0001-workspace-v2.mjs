// Workspace 1 → 2: the fields v0.2 readers rely on, backfilled with the defaults a v0.1
// workspace implies. Nothing here interprets content, so a re-run is a no-op.

// Reported paths use forward slashes on every platform: they end up in CLI output, in the
// event log and in a researcher's `git status`, all of which speak posix.
function relPath(store, type, id) {
  return `${store.entityDir(type).replaceAll('\\', '/')}/${id}.yaml`;
}

function backfill(obj, type) {
  const patch = {};
  if (obj.provenance === undefined) patch.provenance = { method: 'imported', derived_from: [] };
  if (type === 'claim' && obj.contradicts === undefined) patch.contradicts = [];
  return Object.keys(patch).length > 0 ? { ...obj, ...patch } : null;
}

// The change list is computed before anything is written so `preview` and `apply` cannot
// disagree about what this step touches.
async function planChanges(store) {
  const changes = [];
  for (const type of ['claim', 'evidence']) {
    for (const obj of await store.listEntities(type)) {
      const updated = backfill(obj, type);
      if (updated) changes.push({ path: relPath(store, type, obj.id), entity: updated });
    }
  }

  const project = await store.readProject();
  if (project !== null && project.workspace_version !== 2) {
    changes.push({ path: 'phdude.yaml', project: { ...project, workspace_version: 2 } });
  }

  return changes;
}

export default {
  from: 1,
  to: 2,

  describe() {
    return 'add provenance to claims and evidence, contradicts to claims';
  },

  /**
   * @param {object} store
   * @returns {Promise<string[]>} the workspace-relative paths this step would rewrite
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
      if (change.entity) await store.writeEntity(change.entity);
      else await store.writeProject(change.project);
    }
    return { changed: changes.map((change) => change.path) };
  },
};
