const RELATIONS = {
  'phdude.evidence': [{ field: 'source', rel: 'cites', multi: false }],
  'phdude.claim': [
    { field: 'supported_by', rel: 'supported_by', multi: true },
    { field: 'questions', rel: 'addresses', multi: true },
  ],
  'phdude.fact': [{ field: 'from.artifact', rel: 'from', multi: false }],
  'phdude.source': [{ field: 'artifacts', rel: 'has_artifact', multi: true }],
  'phdude.hypothesis': [{ field: 'questions', rel: 'addresses', multi: true }],
  'phdude.method': [{ field: 'questions', rel: 'addresses', multi: true }],
  'phdude.decision': [{ field: 'affects', rel: 'affects', multi: true }],
  'phdude.artifact': [{ field: 'versions_of', rel: 'version_of', multi: false }],
};

function readField(obj, path) {
  return path.split('.').reduce((v, key) => v?.[key], obj);
}

/**
 * @param {object[]} objects
 * @returns {{ nodes: Map<string, object>, edges: {from: string, to: string, rel: string}[], dangling: {from: string, to: string, rel: string}[] }}
 */
export function buildGraph(objects) {
  const nodes = new Map();
  for (const obj of objects) {
    if (obj?.id) nodes.set(obj.id, obj);
  }

  const edges = [];
  const dangling = [];

  for (const obj of nodes.values()) {
    for (const { field, rel, multi } of RELATIONS[obj.schema] ?? []) {
      const value = readField(obj, field);
      const targets = multi ? (value ?? []) : value === undefined ? [] : [value];
      for (const to of targets) {
        if (to === undefined || to === null) continue;
        const edge = { from: obj.id, to, rel };
        if (nodes.has(to)) edges.push(edge);
        else dangling.push(edge);
      }
    }
  }

  return { nodes, edges, dangling };
}

function bfsCollect(graph, start, neighborsOf) {
  const visited = new Set([start]);
  const order = [];
  let frontier = [start];
  while (frontier.length > 0) {
    const found = new Set();
    for (const cur of frontier) {
      for (const n of neighborsOf(cur)) {
        if (!visited.has(n)) found.add(n);
      }
    }
    const next = [...found].sort();
    for (const n of next) visited.add(n);
    order.push(...next);
    frontier = next;
  }
  return order;
}

/**
 * @param {{nodes: Map<string, object>, edges: {from: string, to: string, rel: string}[]}} graph
 * @param {string} id
 * @returns {{ up: string[], down: string[] }}
 */
export function trace(graph, id) {
  if (!graph.nodes.has(id)) return { up: [], down: [] };
  const outNeighbors = (nodeId) => graph.edges.filter((e) => e.from === nodeId).map((e) => e.to);
  const inNeighbors = (nodeId) => graph.edges.filter((e) => e.to === nodeId).map((e) => e.from);
  return {
    up: bfsCollect(graph, id, outNeighbors),
    down: bfsCollect(graph, id, inNeighbors),
  };
}
