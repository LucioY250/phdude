export function detectFactConflicts(facts, decisions) {
  const byKey = new Map();

  for (const fact of facts) {
    if (fact.state === 'rejected') continue;
    if (!byKey.has(fact.key)) byKey.set(fact.key, []);
    byKey.get(fact.key).push(fact);
  }

  const conflicts = [];

  for (const [key, factGroup] of byKey) {
    const valuesByString = new Map();
    for (const fact of factGroup) {
      const valueStr = String(fact.value);
      if (!valuesByString.has(valueStr)) valuesByString.set(valueStr, []);
      valuesByString.get(valueStr).push(fact);
    }

    if (valuesByString.size < 2) continue;

    const allArtifacts = new Set(factGroup.map((f) => f.from.artifact));
    if (allArtifacts.size < 2) continue;

    const values = factGroup
      .map((f) => ({
        value: f.value,
        unit: f.unit ?? null,
        from: {
          artifact: f.from.artifact,
          locator: f.from.locator ?? null,
        },
        factId: f.id,
        state: f.state,
      }))
      .sort((a, b) => a.factId.localeCompare(b.factId));

    let resolved = null;
    const approvedDecisions = decisions
      .filter((d) => d.status === 'approved' && d.change.fact_key === key)
      .sort((a, b) => a.id.localeCompare(b.id));

    if (approvedDecisions.length > 0) {
      const dec = approvedDecisions[0];
      resolved = {
        decision: dec.id,
        canonical_value: dec.change.canonical_value ?? null,
      };
    }

    conflicts.push({
      key,
      values,
      resolved,
    });
  }

  conflicts.sort((a, b) => a.key.localeCompare(b.key));
  return conflicts;
}

export function openConflicts(conflicts) {
  return conflicts.filter((c) => c.resolved === null);
}
