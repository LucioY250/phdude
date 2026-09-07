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

// `contradicts` is recorded on both claims (symmetric), but as a related object rather than a
// dependency it must appear once per pair, not once per side. The pair is represented with the
// lower id first regardless of which claim's field produced it, so both sides collapse to the
// same edge and de-dupe correctly.
function contradictsRelations(nodes) {
  const edges = [];
  const dangling = [];
  const seen = new Set();

  for (const obj of nodes.values()) {
    if (obj.schema !== 'phdude.claim') continue;
    for (const to of obj.contradicts ?? []) {
      const [lo, hi] = obj.id < to ? [obj.id, to] : [to, obj.id];
      const key = `${lo} ${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const edge = { from: lo, to: hi, rel: 'contradicts' };
      if (nodes.has(to)) edges.push(edge);
      else dangling.push(edge);
    }
  }

  return { edges, dangling };
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

  const contradicts = contradictsRelations(nodes);
  edges.push(...contradicts.edges);
  dangling.push(...contradicts.dangling);

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
 * `up` is what an object depends on (outgoing edges), `down` is what depends on it (incoming
 * edges) - except `contradicts`, which is not a dependency in either direction: it is a related
 * object, so it is reported in `down` for both claims in the pair and never in `up`.
 * @param {{nodes: Map<string, object>, edges: {from: string, to: string, rel: string}[]}} graph
 * @param {string} id
 * @returns {{ up: string[], down: string[] }}
 */
export function trace(graph, id) {
  if (!graph.nodes.has(id)) return { up: [], down: [] };

  const directional = graph.edges.filter((e) => e.rel !== 'contradicts');
  const symmetric = graph.edges.filter((e) => e.rel === 'contradicts');

  const outNeighbors = (nodeId) => directional.filter((e) => e.from === nodeId).map((e) => e.to);
  const inNeighbors = (nodeId) => [
    ...directional.filter((e) => e.to === nodeId).map((e) => e.from),
    ...symmetric
      .filter((e) => e.from === nodeId || e.to === nodeId)
      .map((e) => (e.from === nodeId ? e.to : e.from)),
  ];

  return {
    up: bfsCollect(graph, id, outNeighbors),
    down: bfsCollect(graph, id, inNeighbors),
  };
}
