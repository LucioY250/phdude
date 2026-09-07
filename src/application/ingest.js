import { join, relative, sep } from 'node:path';
import { sha256 } from '../domain/hash.js';
import { makeId } from '../domain/ids.js';
import { newArtifact, mimeFor } from '../domain/entities.js';
import { linkVersions } from '../domain/versions.js';
import { PhdudeError } from '../domain/errors.js';

function toRelPath(root, absPath) {
  return relative(root, absPath).split(sep).join('/');
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function padNum(i) {
  return String(i + 1).padStart(2, '0');
}

function csvField(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(csvField).join(',')).join('\n') + (rows.length ? '\n' : '');
}

async function writeCache(store, id, hash, kind, parsed) {
  const base = ['.phdude', 'cache', id];

  const sectionEntries = parsed.sections.map((s, i) => ({
    title: s.title,
    file: `sections/${padNum(i)}-${slugify(s.title) || 'section'}.md`,
    chars: s.text.length,
  }));
  const tableEntries = parsed.tables.map((t, i) => ({
    name: t.name,
    file: `tables/${padNum(i)}-${slugify(t.name) || 'table'}.csv`,
    rows: t.rows.length,
  }));

  const manifest = {
    id,
    hash,
    kind,
    sections: sectionEntries,
    tables: tableEntries,
    meta: parsed.meta,
    warnings: parsed.warnings,
  };

  await store.writeTextAtomic(join(...base, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await store.writeTextAtomic(join(...base, 'text.md'), parsed.text);

  for (let i = 0; i < parsed.sections.length; i++) {
    const s = parsed.sections[i];
    const content = s.title ? `# ${s.title}\n\n${s.text}\n` : `${s.text}\n`;
    await store.writeTextAtomic(join(...base, ...sectionEntries[i].file.split('/')), content);
  }
  for (let i = 0; i < parsed.tables.length; i++) {
    await store.writeTextAtomic(
      join(...base, ...tableEntries[i].file.split('/')),
      toCsv(parsed.tables[i].rows),
    );
  }
}

async function collectFiles(fs, store, requestedPath) {
  const absPath = join(store.root, requestedPath);
  const files = [];
  try {
    for await (const entry of fs.walk(absPath)) {
      files.push({
        absPath: entry.path,
        relPath: toRelPath(store.root, entry.path),
        mtime: entry.mtime,
      });
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new PhdudeError(
        'USAGE',
        `no such path: ${requestedPath}`,
        'check the path or run phdude ingest with no arguments',
      );
    }
    throw err;
  }
  return files;
}

async function extract(parsers, bytes, relPath, kind) {
  const parser = parsers.parserFor(kind);
  let extracted = {
    status: 'unavailable',
    method: '',
    text_chars: 0,
    sections: 0,
    tables: 0,
    warnings: [],
  };
  let parsed = null;

  if (!parser) {
    extracted.warnings = [`no parser for kind ${kind}`];
    return { extracted, parsed };
  }

  if (!(await parser.available())) {
    let hint = null;
    try {
      hint = await parser.parse(bytes, { path: relPath });
    } catch {
      /* fall through to the generic warning below */
    }
    extracted.warnings = hint?.warnings?.length
      ? hint.warnings
      : [`${parser.name} parser unavailable`];
    return { extracted, parsed };
  }

  try {
    const result = await parser.parse(bytes, { path: relPath });
    const chars = result.text.length;
    extracted = {
      status: chars > 0 ? 'ok' : 'partial',
      method: parser.name,
      text_chars: chars,
      sections: result.sections.length,
      tables: result.tables.length,
      warnings: result.warnings,
    };
    parsed = result;
  } catch (err) {
    extracted = {
      status: 'failed',
      method: '',
      text_chars: 0,
      sections: 0,
      tables: 0,
      warnings: [err.message],
    };
  }
  return { extracted, parsed };
}

function sortedUnique(arr) {
  return [...new Set(arr)].sort();
}

function sameSet(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * @param {{store: object, fs: {walk: Function, read: Function}, parsers: {detectKind: Function, parserFor: Function}, clock: Function, actor: object}} deps
 * @param {{paths?: string[], force?: boolean}} opts
 * @returns {Promise<{artifacts: object[], skipped: string[], warnings: string[]}>}
 */
export async function ingest(
  { store, fs, parsers, clock, actor },
  { paths = ['sources'], force = false } = {},
) {
  const discovered = [];
  for (const p of paths) {
    discovered.push(...(await collectFiles(fs, store, p)));
  }

  const groups = new Map(); // hash -> { hash, bytes, entries: [{relPath, mtime}] }
  const seenAbs = new Set();
  for (const f of discovered) {
    if (seenAbs.has(f.absPath)) continue;
    seenAbs.add(f.absPath);
    const bytes = await fs.read(f.absPath);
    const hash = sha256(bytes);
    let g = groups.get(hash);
    if (!g) {
      g = { hash, bytes, entries: [] };
      groups.set(hash, g);
    }
    g.entries.push({ relPath: f.relPath, mtime: f.mtime });
  }

  const skipped = [];
  const warnings = [];
  const writtenIds = new Set();
  const touched = new Map();

  for (const g of groups.values()) {
    const { hash, bytes } = g;
    const relPaths = sortedUnique(g.entries.map((e) => e.relPath));
    const latestMtime = g.entries.reduce(
      (max, e) => (e.mtime > max ? e.mtime : max),
      g.entries[0].mtime,
    );
    const id = makeId('artifact', bytes);
    const existing = await store.readEntity(id);

    if (existing && existing.hash === hash && !force) {
      const cacheShouldExist =
        existing.extracted.status === 'ok' || existing.extracted.status === 'partial';
      const cacheOk = !cacheShouldExist || (await store.readCacheText(id)) !== null;
      if (cacheOk) {
        const mergedPaths = sortedUnique([...existing.paths, ...relPaths]);
        if (sameSet(mergedPaths, sortedUnique(existing.paths))) {
          skipped.push(id);
          continue;
        }
        const updated = { ...existing, paths: mergedPaths, path: mergedPaths[0] };
        await store.writeEntity(updated);
        touched.set(id, updated);
        writtenIds.add(id);
        continue;
      }
    }

    const relPath = relPaths[0];
    const kind = parsers.detectKind(bytes, relPath);
    const { extracted, parsed } = await extract(parsers, bytes, relPath, kind);
    for (const w of extracted.warnings) warnings.push(`${relPath}: ${w}`);

    if (parsed) await writeCache(store, id, hash, kind, parsed);

    const base =
      existing ??
      newArtifact({
        id,
        path: relPath,
        hash,
        bytes: bytes.length,
        kind,
        mtime: latestMtime,
        actor,
        created: clock(),
      });

    const artifact = {
      ...base,
      path: relPaths[0],
      paths: relPaths,
      hash,
      bytes: bytes.length,
      mime: mimeFor(kind),
      kind,
      extracted,
      mtime: latestMtime,
    };

    await store.writeEntity(artifact);
    touched.set(id, artifact);
    writtenIds.add(id);
  }

  const onDisk = await store.listEntities('artifact');
  const combined = new Map(onDisk.map((a) => [a.id, a]));
  for (const [id, a] of touched) combined.set(id, a);

  const linked = linkVersions([...combined.values()]);
  const artifacts = [];

  for (const after of linked) {
    const before = combined.get(after.id);
    const isTouched = touched.has(after.id);
    const versionChanged =
      before.versions_of !== after.versions_of || before.latest !== after.latest;

    if (isTouched) {
      if (versionChanged) await store.writeEntity(after);
      artifacts.push(after);
    } else if (versionChanged) {
      await store.writeEntity(after);
      writtenIds.add(after.id);
      artifacts.push(after);
    }
  }

  await store.appendEvent({
    ts: clock(),
    op: 'ingest',
    actor,
    ids: [...writtenIds],
    summary: `ingested ${writtenIds.size}, skipped ${skipped.length}`,
  });

  return { artifacts, skipped, warnings };
}
