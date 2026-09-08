// Which renderer answers for a format. The renderers themselves are adapters injected as
// `deps.renderers`; picking one is a rule, so it lives here and the application never reaches
// into the adapter layer to ask.

/**
 * @param {object[]|Record<string, object>|null|undefined} renderers - in precedence order
 * @param {string} format
 * @returns {object|null} the renderer, or null when nothing claims the format
 */
export function rendererFor(renderers, format) {
  const list = Array.isArray(renderers) ? renderers : Object.values(renderers ?? {});
  return list.find((r) => Array.isArray(r?.formats) && r.formats.includes(format)) ?? null;
}
