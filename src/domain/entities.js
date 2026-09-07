const ARTIFACT_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain',
  bib: 'application/x-bibtex',
  tex: 'application/x-tex',
  other: 'application/octet-stream',
};

export function mimeFor(kind) {
  return ARTIFACT_MIME[kind] ?? ARTIFACT_MIME.other;
}

/**
 * @param {object} p
 * @param {string} p.id
 * @param {string} p.path
 * @param {string} p.hash
 * @param {number} p.bytes
 * @param {string} p.kind
 * @param {string} p.mtime
 * @param {object} p.actor
 * @param {string} p.created
 * @returns {object} a schema-valid `phdude.artifact`
 */
export function newArtifact({ id, path, hash, bytes, kind, mtime, actor, created }) {
  return {
    schema: 'phdude.artifact',
    version: 1,
    id,
    created,
    actor,
    path,
    paths: [path],
    hash,
    bytes,
    mime: mimeFor(kind),
    kind,
    role: 'unknown',
    extracted: {
      status: 'unavailable',
      method: '',
      text_chars: 0,
      sections: 0,
      tables: 0,
      warnings: [],
    },
    mtime,
  };
}
