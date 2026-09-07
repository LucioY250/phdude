export const KNOWLEDGE_STATES = ['canonical', 'supported', 'candidate', 'disputed', 'rejected'];
export const DECISION_STATUS = ['proposed', 'approved', 'rejected', 'superseded'];
const ALLOWED = {
  candidate: ['supported', 'canonical', 'disputed', 'rejected'],
  supported: ['canonical', 'disputed', 'rejected', 'candidate'],
  canonical: ['disputed', 'rejected', 'supported'],
  disputed: ['supported', 'canonical', 'rejected', 'candidate'],
  rejected: ['candidate'],
};
export function canTransition(from, to) {
  return Boolean(ALLOWED[from]?.includes(to));
}
