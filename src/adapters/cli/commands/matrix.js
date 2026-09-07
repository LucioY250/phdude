import * as matrixApp from '../../../application/matrix.js';
import { renderMatrix } from '../output.js';

export default async function matrixCommand({ flags, deps }) {
  const result = await matrixApp.matrix(
    { store: deps.store },
    { format: flags.format, question: flags.question },
  );
  return { text: renderMatrix(result.rows, result.format), json: result };
}
