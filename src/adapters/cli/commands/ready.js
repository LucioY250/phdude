import * as readiness from '../../../application/ready.js';
import { renderReady } from '../output.js';

export default async function readyCommand({ deps, flags }) {
  const report = await readiness.check(
    { store: deps.store, clock: deps.clock, loadProfile: deps.loadProfile },
    { profile: flags.profile },
  );
  return { text: renderReady(report), json: report, exitCode: report.ready ? 0 : 2 };
}
