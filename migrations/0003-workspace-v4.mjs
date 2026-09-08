// Workspace 3 → 4: the venue list a v0.6 reader expects in phdude.yaml, and the empty template
// registry `phdude template` writes into. Nothing here interprets content, so a re-run is a no-op.

const TEMPLATES_PATH = '.phdude/templates.yaml';

// Kept in step with what a fresh `phdude init` writes (src/application/init.js): a workspace
// that migrated to 4 and one created at 4 have to hold the same registry, or `template list`
// would answer differently depending on which one it is reading.
const EMPTY_TEMPLATE_REGISTRY = { schema: 'phdude.templates', version: 1, templates: [] };

// The change list is computed before anything is written so `preview` and `apply` cannot
// disagree about what this step touches.
async function planChanges(store) {
  const changes = [];

  if (!(await store.exists(TEMPLATES_PATH))) {
    changes.push({ path: TEMPLATES_PATH, registry: EMPTY_TEMPLATE_REGISTRY });
  }

  const project = await store.readProject();
  if (project !== null && (project.venues === undefined || project.workspace_version !== 4)) {
    changes.push({
      path: 'phdude.yaml',
      // A `venues` a researcher already wrote stays as written, including an empty list.
      project: { ...project, venues: project.venues ?? [], workspace_version: 4 },
    });
  }

  return changes;
}

export default {
  from: 3,
  to: 4,

  describe() {
    return 'add the applied venue list and the template registry';
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
      if (change.registry) await store.writeYamlAtomic(change.path, change.registry);
      else await store.writeProject(change.project);
    }
    return { changed: changes.map((change) => change.path) };
  },
};
