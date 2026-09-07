import { readFile, appendFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { parse, stringify } from 'yaml';
import { parseId } from '../../domain/ids.js';
import { PhdudeError } from '../../domain/errors.js';
import { assertValid } from '../../schemas/index.js';
import { writeFileAtomic } from './atomic.js';

const ENTITY_DIRS = {
  artifact: join('knowledge', 'artifacts'),
  source: join('knowledge', 'sources'),
  claim: join('knowledge', 'claims'),
  evidence: join('knowledge', 'evidence'),
  fact: join('knowledge', 'facts'),
  result: join('knowledge', 'results'),
  question: join('research', 'questions'),
  hypothesis: join('research', 'hypotheses'),
  decision: 'decisions',
};

export class FsStore {
  constructor(root) {
    this.root = root;
    this.paths = {
      project: join(root, 'phdude.yaml'),
      phdude: join(root, '.phdude'),
      events: join(root, '.phdude', 'events.jsonl'),
      cache: join(root, '.phdude', 'cache'),
      sources: join(root, ENTITY_DIRS.source),
      knowledge: join(root, 'knowledge'),
      research: join(root, 'research'),
      decisions: join(root, ENTITY_DIRS.decision),
    };
  }

  entityDir(type) {
    return ENTITY_DIRS[type];
  }

  async readYaml(relPath) {
    try {
      const text = await readFile(join(this.root, relPath), 'utf8');
      return parse(text);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeYamlAtomic(relPath, obj) {
    // aliasDuplicateObjects: false keeps `&a1` / `*a1` anchors out of persisted objects, so a
    // researcher can read, diff and merge the YAML without knowing YAML's aliasing rules.
    await writeFileAtomic(
      join(this.root, relPath),
      stringify(obj, { lineWidth: 0, aliasDuplicateObjects: false }),
    );
  }

  async readText(relPath) {
    try {
      return await readFile(join(this.root, relPath), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeTextAtomic(relPath, text) {
    await writeFileAtomic(join(this.root, relPath), text);
  }

  async readProject() {
    const cfg = await this.readYaml('phdude.yaml');
    if (cfg !== null) assertValid('project', cfg);
    return cfg;
  }

  async writeProject(cfg) {
    assertValid('project', cfg);
    await this.writeYamlAtomic('phdude.yaml', cfg);
  }

  // An entity file that parses to null, to a non-object, or without an id is a merge conflict
  // or an interrupted write, not an entity. Naming the file beats a bare TypeError from a
  // downstream sort (spec §13).
  async readEntityYaml(relPath) {
    let text;
    try {
      text = await readFile(join(this.root, relPath), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    const obj = parse(text);
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj) || obj.id === undefined) {
      throw new PhdudeError(
        'VALIDATION',
        `malformed entity file: ${relPath.split(sep).join('/')}`,
        'fix or delete the file',
      );
    }
    return obj;
  }

  async readEntity(id) {
    const parsed = parseId(id);
    if (!parsed) return null;
    return this.readEntityYaml(join(this.entityDir(parsed.type), `${id}.yaml`));
  }

  async writeEntity(obj) {
    const parsed = parseId(obj?.id);
    if (!parsed)
      throw new PhdudeError(
        'VALIDATION',
        `invalid entity id: ${obj?.id}`,
        'ids look like CLAIM-<10 hex> or RQ-<n>',
      );
    const type = parsed.type;
    assertValid(type, obj);
    const relPath = join(this.entityDir(type), `${obj.id}.yaml`);
    await this.writeYamlAtomic(relPath, obj);
    return join(this.root, relPath);
  }

  async listEntities(type) {
    const dir = this.entityDir(type);
    let files;
    try {
      files = await readdir(join(this.root, dir));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const objs = await Promise.all(
      files.filter((f) => f.endsWith('.yaml')).map((f) => this.readEntityYaml(join(dir, f))),
    );
    return objs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  async appendEvent(evt) {
    assertValid('event', evt);
    await mkdir(this.paths.phdude, { recursive: true });
    await appendFile(this.paths.events, JSON.stringify(evt) + '\n');
  }

  async readEvents(limit) {
    let text;
    try {
      text = await readFile(this.paths.events, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const objs = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return limit === undefined ? objs : objs.slice(-limit);
  }

  cacheDir(artId) {
    return join(this.paths.cache, artId);
  }

  async listCacheEntries() {
    let entries;
    try {
      entries = await readdir(this.paths.cache, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  }

  async readCacheText(artId) {
    try {
      return await readFile(join(this.cacheDir(artId), 'text.md'), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async exists(relPath) {
    try {
      await stat(join(this.root, relPath));
      return true;
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false;
      throw err;
    }
  }
}
