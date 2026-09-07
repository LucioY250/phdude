import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The generators the package ships (`generators/bar-chart.mjs`). Resolved from this file rather
// than from the workspace, so a figure that names `phdude:bar-chart` finds it whether PhDude is
// a checkout or a global install - and so no workspace ever records where PhDude lives.
export const DEFAULT_GENERATORS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'generators',
);
