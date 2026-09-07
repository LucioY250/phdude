// A declared analysis that exits non-zero is the same class of failure as an interpreter that
// is not installed: PhDude did its part, and the thing it called did not come back. Both exit 4.
export const EXIT_CODES = {
  OK: 0,
  USAGE: 1,
  VALIDATION: 2,
  POLICY: 3,
  TOOL_MISSING: 4,
  EXECUTION: 4,
};
export class PhdudeError extends Error {
  constructor(code, message, hint = null, details = null) {
    super(message);
    this.name = 'PhdudeError';
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}
export function exitCodeFor(err) {
  return err instanceof PhdudeError && EXIT_CODES[err.code] !== undefined
    ? EXIT_CODES[err.code]
    : 1;
}
