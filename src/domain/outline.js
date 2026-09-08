// The presentation outline (spec §3.4): the approved manuscript, or the claims the evidence
// already supports, as slides. Pure: it reads records and returns Markdown, and never decides
// that something is presentable - approval and claim state decided that already.

import { PhdudeError } from './errors.js';

export const OUTLINE_SOURCES = ['manuscript', 'claims'];

const MAX_BULLETS = 3;
const MAX_BULLET_CHARS = 200;
const PRESENTABLE_CLAIM_STATES = ['supported', 'canonical'];
const STRENGTH_ORDER = ['strong', 'moderate', 'weak', 'unknown'];
const EMPTY_SLIDE = '(no evidence linked yet)';

function strengthRank(evidence) {
  const rank = STRENGTH_ORDER.indexOf(evidence.strength);
  return rank === -1 ? STRENGTH_ORDER.length : rank;
}

// Strongest first, and ties broken by id: two moderate excerpts must land in the same order on
// every machine, or the outline file changes without the research changing.
function byStrength(a, b) {
  const rank = strengthRank(a) - strengthRank(b);
  if (rank !== 0) return rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function bulletFor(evidence) {
  const excerpt = String(evidence.excerpt ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const text =
    excerpt.length > MAX_BULLET_CHARS
      ? `${excerpt.slice(0, MAX_BULLET_CHARS).trimEnd()}…`
      : excerpt;
  const locator = String(evidence.locator ?? '').trim();
  return locator === '' ? text : `${text} (${locator})`;
}

function bulletsFrom(claimIds, byId, evidenceById) {
  const seen = new Map();
  for (const claimId of claimIds) {
    for (const evidenceId of byId.get(claimId)?.supported_by ?? []) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence || evidence.state === 'rejected') continue;
      seen.set(evidence.id, evidence);
    }
  }
  const bullets = [...seen.values()].sort(byStrength).slice(0, MAX_BULLETS).map(bulletFor);
  return bullets.length === 0 ? [EMPTY_SLIDE] : bullets;
}

function nothingToShow(from) {
  return from === 'manuscript'
    ? new PhdudeError(
        'VALIDATION',
        'no approved section to outline',
        'approve a section with phdude manuscript approve, or outline the claims with --from claims',
      )
    : new PhdudeError(
        'VALIDATION',
        'no supported or canonical claim to outline',
        'promote a claim with phdude promote, or outline the manuscript with --from manuscript',
      );
}

/**
 * The slides an outline is made of, before they are rendered.
 * @param {{from?: 'manuscript'|'claims', manuscript?: object, sections?: object[],
 *   claims?: object[], evidence?: object[]}} input
 * @returns {{title: string, bullets: string[]}[]}
 */
export function outlineSlides({
  from = 'manuscript',
  manuscript = null,
  sections,
  claims = [],
  evidence = [],
} = {}) {
  if (!OUTLINE_SOURCES.includes(from)) {
    throw new PhdudeError(
      'VALIDATION',
      `unknown outline source: ${from}`,
      `--from is ${OUTLINE_SOURCES.join(' or ')}`,
    );
  }

  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const evidenceById = new Map(evidence.map((record) => [record.id, record]));

  if (from === 'claims') {
    return claims
      .filter((claim) => PRESENTABLE_CLAIM_STATES.includes(claim.state))
      .map((claim) => ({
        title: String(claim.statement ?? '').trim(),
        bullets: bulletsFrom([claim.id], claimById, evidenceById),
      }));
  }

  return [...(sections ?? manuscript?.sections ?? [])]
    .filter((section) => section.status === 'approved')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((section) => ({
      title: section.title ?? section.id,
      bullets: bulletsFrom(section.claims ?? [], claimById, evidenceById),
    }));
}

/**
 * The outline as Markdown: a title slide, then one `##` slide per approved section (or per
 * claim the evidence supports) with up to three of its strongest excerpts as bullets.
 * @param {{from?: 'manuscript'|'claims', manuscript?: object, sections?: object[],
 *   claims?: object[], evidence?: object[]}} input
 * @returns {string}
 */
export function outline(input = {}) {
  const slides = outlineSlides(input);
  if (slides.length === 0) throw nothingToShow(input.from ?? 'manuscript');

  const title = String(input.manuscript?.title ?? '').trim();
  const lines = title === '' ? [] : [`# ${title}`, ''];
  for (const slide of slides) {
    lines.push(`## ${slide.title}`, '', ...slide.bullets.map((bullet) => `- ${bullet}`), '');
  }
  return lines.join('\n');
}
