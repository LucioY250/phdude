import { readFile, appendFile, mkdir, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize, sep } from 'node:path';
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
  candidate: join('knowledge', 'candidates'),
  dataset: join('knowledge', 'datasets'),
  analysis: 'analysis',
  table: 'tables',
  figure: 'figures',
  question: join('research', 'questions'),
  hypothesis: join('research', 'hypotheses'),
  method: join('research', 'methods'),
  search: join('research', 'searches'),
  decision: 'decisions',
};

const TEMPLATES_FILE = join('.phdude', 'templates.yaml');
const SKILLS_LOCK_FILE = join('.phdude', 'skills-lock.yaml');
const MANUSCRIPT_DIR = 'manuscript';
const MANUSCRIPT_FILE = join(MANUSCRIPT_DIR, 'manuscript.yaml');
const REPORTS_DIR = join(MANUSCRIPT_DIR, 'reports');
const SECTION_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

  // A policy file the researcher hand-edited into invalid YAML is the same class of problem as
  // a merge-conflicted entity file (see readEntityYaml): the fix is to name the file, not to
  // let a YAMLParseError reach the researcher untyped.
  async readYaml(relPath) {
    let text;
    try {
      text = await readFile(join(this.root, relPath), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    try {
      return parse(text);
    } catch {
      throw new PhdudeError(
        'VALIDATION',
        `malformed YAML: ${relPath.split(sep).join('/')}`,
        'fix the file',
      );
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

  // The bytes, not the text: a dataset's identity is its file's bytes, and an xlsx decoded as
  // utf8 would hash to something the workspace never recorded.
  async readBytes(relPath) {
    try {
      return await readFile(join(this.root, relPath));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  // An external renderer writes its own output file, so the directory has to be there before it
  // runs: every other write in the store creates it on the way past.
  async ensureDir(relPath) {
    await mkdir(join(this.root, relPath), { recursive: true });
  }

  // A rendered document is bytes, not text: an `.xlsx` written through writeTextAtomic would be
  // re-encoded and stop being a package a reader can open.
  async writeBytesAtomic(relPath, bytes) {
    await writeFileAtomic(join(this.root, relPath), bytes);
  }

  async readTemplates() {
    const obj = await this.readYaml(TEMPLATES_FILE);
    if (obj !== null) assertValid('templates-registry', obj);
    return obj;
  }

  async writeTemplates(registry) {
    assertValid('templates-registry', registry);
    await this.writeYamlAtomic(TEMPLATES_FILE, registry);
    return join(this.root, TEMPLATES_FILE);
  }

  async readSkillsLock() {
    const obj = await this.readYaml(SKILLS_LOCK_FILE);
    if (obj !== null) assertValid('skills-lock', obj);
    return obj;
  }

  async writeSkillsLock(lock) {
    assertValid('skills-lock', lock);
    await this.writeYamlAtomic(SKILLS_LOCK_FILE, lock);
    return join(this.root, SKILLS_LOCK_FILE);
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
    let obj;
    try {
      obj = parse(text);
    } catch {
      obj = null;
    }
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

  async readManuscript() {
    const obj = await this.readYaml(MANUSCRIPT_FILE);
    if (obj !== null) assertValid('manuscript', obj);
    return obj;
  }

  async writeManuscript(manuscript) {
    assertValid('manuscript', manuscript);
    await this.writeYamlAtomic(MANUSCRIPT_FILE, manuscript);
    return join(this.root, MANUSCRIPT_FILE);
  }

  // A section's `file` is workspace-relative and must stay inside `manuscript/`: the path comes
  // out of a YAML file a researcher can edit, so a `../` in it would otherwise let a submit
  // write anywhere in the workspace.
  sectionPath(file) {
    const rel = normalize(String(file ?? ''));
    const inside = !isAbsolute(rel) && rel.startsWith(MANUSCRIPT_DIR + sep) && !rel.includes('..');
    if (!inside) {
      throw new PhdudeError(
        'VALIDATION',
        `section file outside manuscript/: ${file}`,
        'a section file looks like manuscript/<section>.md',
      );
    }
    return rel;
  }

  async readSection(file) {
    return this.readText(this.sectionPath(file));
  }

  async writeSection(file, text) {
    const rel = this.sectionPath(file);
    await this.writeTextAtomic(rel, text);
    return join(this.root, rel);
  }

  reportPath(section) {
    if (!SECTION_ID_RE.test(String(section ?? ''))) {
      throw new PhdudeError(
        'VALIDATION',
        `invalid section id: ${section}`,
        'section ids are lowercase words joined by "-"',
      );
    }
    return join(REPORTS_DIR, `${section}.yaml`);
  }

  async listReports() {
    let files;
    try {
      files = await readdir(join(this.root, REPORTS_DIR));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const reports = await Promise.all(
      files.filter((f) => f.endsWith('.yaml')).map((f) => this.readYaml(join(REPORTS_DIR, f))),
    );
    return reports
      .filter((report) => report !== null && typeof report === 'object')
      .sort((a, b) => (a.section < b.section ? -1 : a.section > b.section ? 1 : 0));
  }

  // Where `phdude write` leaves the assembled context and `submit` the full gate report. It is
  // cache, not record: gitignored, rebuildable, and never what a decision rests on.
  writingDir(section) {
    if (!SECTION_ID_RE.test(String(section ?? ''))) {
      throw new PhdudeError(
        'VALIDATION',
        `invalid section id: ${section}`,
        'section ids are lowercase words joined by "-"',
      );
    }
    return join('.phdude', 'cache', 'writing', section);
  }

  async writeWritingContext(section, text) {
    const rel = join(this.writingDir(section), 'context.md');
    await this.writeTextAtomic(rel, text);
    return join(this.root, rel);
  }

  async writeWritingReport(section, report) {
    const rel = join(this.writingDir(section), 'report.json');
    await this.writeTextAtomic(rel, JSON.stringify(report, null, 2) + '\n');
    return join(this.root, rel);
  }

  async writeReport(section, report) {
    const rel = this.reportPath(section);
    assertValid('section-report', report);
    await this.writeYamlAtomic(rel, report);
    return join(this.root, rel);
  }

  async readReport(section) {
    return this.readYaml(this.reportPath(section));
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
