import { join } from 'node:path';
import { PhdudeError } from '../domain/errors.js';
import { slugify } from '../domain/manuscript.js';
import { outline as renderOutline, outlineSlides } from '../domain/outline.js';
import { rendererFor } from '../domain/renderers.js';
import { templateFor } from '../domain/templates.js';
import { assertUpToDate } from './guard.js';
import { list as listTemplates } from './template.js';

const PPTX_HINT = 'install pandoc to render the outline as a slide deck';

function outputDir(manuscript) {
  return `outputs/${slugify(manuscript.title) || 'manuscript'}`;
}

async function pptxRenderer(renderers) {
  const renderer = rendererFor(renderers, 'pptx');
  if (!renderer) {
    return { renderer: null, warning: `no renderer for pptx: ${PPTX_HINT}` };
  }
  const availability = await renderer.available();
  if (availability?.ok) return { renderer, warning: null };
  return {
    renderer: null,
    warning: `${renderer.name} cannot render pptx: ${availability?.hint ?? PPTX_HINT}`,
  };
}

/**
 * The presentation outline (spec §3.4): one slide per approved section, or per claim the
 * evidence supports, written as Markdown under `outputs/` and rendered to PPTX when a renderer
 * is installed. An outline whose Markdown already says exactly this writes nothing and records
 * nothing, so a rebuild loop leaves no history of runs that changed nothing.
 * @param {{store: object, clock: () => string, actor: object, renderers?: object}} deps
 * @param {{from?: 'manuscript'|'claims', profile?: string|null, force?: boolean}} [opts]
 * @returns {Promise<{from: string, slides: number, written: boolean, reason: string|null,
 *   outputs: {format: string, path: string}[], warnings: string[]}>}
 */
export async function outline(
  { store, clock, actor, renderers },
  { from = 'manuscript', profile = null, force = false } = {},
) {
  assertUpToDate(await store.readProject());

  const manuscript = await store.readManuscript();
  if (manuscript === null) {
    throw new PhdudeError(
      'VALIDATION',
      'no manuscript to outline',
      'run phdude manuscript init first',
    );
  }

  const claims = await store.listEntities('claim');
  const evidence = await store.listEntities('evidence');
  const input = { from, manuscript, claims, evidence };
  const markdown = renderOutline(input);
  const slides = outlineSlides(input).length;

  const dir = outputDir(manuscript);
  const mdPath = `${dir}/outline.md`;
  const pptxPath = `${dir}/outline.pptx`;

  const { renderer, warning } = await pptxRenderer(renderers);
  const warnings = warning === null ? [] : [warning];

  const unchanged =
    !force &&
    (await store.readText(mdPath)) === markdown &&
    (renderer === null || (await store.exists(pptxPath)));
  if (unchanged) {
    const outputs = [{ format: 'md', path: mdPath }];
    if (renderer !== null) outputs.push({ format: 'pptx', path: pptxPath });
    return { from, slides, written: false, reason: 'up to date', outputs, warnings };
  }

  await store.writeTextAtomic(mdPath, markdown);
  const outputs = [{ format: 'md', path: mdPath }];

  if (renderer !== null) {
    const reference =
      templateFor({ templates: await listTemplates({ store }) }, { kind: 'pptx', profile }) ?? null;
    const result = await renderer.render({
      input: {
        markdownPath: join(store.root, mdPath),
        referenceDoc: reference === null ? undefined : join(store.root, reference.path),
        metadata: { title: manuscript.title },
      },
      output: { path: join(store.root, pptxPath), format: 'pptx' },
      cwd: store.root,
    });
    warnings.push(...(result?.warnings ?? []));
    outputs.push({ format: 'pptx', path: pptxPath });
  }

  await store.appendEvent({
    ts: clock(),
    op: 'present',
    actor,
    ids: [],
    summary: `outline written: ${outputs.map((o) => o.path).join(', ')} (${slides} slide(s))`,
  });

  return { from, slides, written: true, reason: null, outputs, warnings };
}
