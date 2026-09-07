import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BUDGET_CHARS,
  PRIORITY,
  assembleContext,
  sectionClaims,
} from '../../../src/domain/context-budget.js';

const SOURCE = {
  id: 'SRC-0123456789',
  title: 'Adoption in SMEs',
  authors: ['Z. Zeta'],
  year: 2020,
};
const EVIDENCE = {
  id: 'EVID-1111111111',
  source: 'SRC-0123456789',
  locator: 'p. 3',
  excerpt: 'Adoption is slow among small firms.',
  strength: 'moderate',
};
const WEAKER = {
  id: 'EVID-2222222222',
  source: 'SRC-0123456789',
  locator: 'p. 9',
  excerpt: 'A weaker restatement.',
  strength: 'weak',
};
const CLAIM = {
  id: 'CLAIM-1111111111',
  statement: 'SMEs adopt AI slowly.',
  state: 'supported',
  supported_by: ['EVID-2222222222', 'EVID-1111111111'],
  questions: ['RQ-1'],
  sections: ['Introduction'],
};

function snapshot(overrides = {}) {
  return {
    project: { title: 'A thesis', language: 'en' },
    manuscript: {
      title: 'A thesis',
      language: 'en',
      sections: [
        {
          id: 'introduction',
          title: 'Introduction',
          file: 'manuscript/introduction.md',
          order: 2,
          status: 'planned',
          hash: null,
          claims: [],
          questions: [],
        },
      ],
    },
    questions: [{ id: 'RQ-1', text: 'How fast do SMEs adopt AI?' }],
    methods: [],
    facts: [],
    claims: [CLAIM],
    evidence: [EVIDENCE, WEAKER],
    sources: [SOURCE],
    ...overrides,
  };
}

const BIBKEYS = new Map([['SRC-0123456789', 'zeta2020adoption']]);

function context(options = {}) {
  return assembleContext(snapshot(options.snapshot), 'introduction', {
    bibkeys: BIBKEYS,
    ...options,
  });
}

test('the context is assembled in the PRD §70 priority order', () => {
  const result = context();
  assert.deepEqual(
    result.included.map((item) => item.kind),
    ['instruction', 'facts', 'claim', 'bibkeys', 'policy', 'voice', 'epistemic'],
  );
  assert.deepEqual(result.truncated, []);
  assert.deepEqual([...new Set(result.included.map((i) => i.kind))], PRIORITY);
});

test('the instruction carries the section purpose, the manuscript title and the language', () => {
  const { markdown } = context();
  assert.match(markdown, /# Writing context: Introduction/);
  assert.match(markdown, /Manuscript: A thesis \(language en\)/);
  assert.match(markdown, /Purpose: Establish the problem/);
});

test('a claim carries its state, its marker and its strongest evidence with a citation key', () => {
  const { markdown } = context();
  assert.match(markdown, /### CLAIM-1111111111 \(supported\)/);
  assert.match(markdown, /Assert it with: <!-- claim: CLAIM-1111111111 -->/);
  assert.match(
    markdown,
    /Strongest evidence: EVID-1111111111 \(moderate\), cite as \[@zeta2020adoption\]/,
  );
  assert.match(markdown, /Locator: p\. 3/);
  assert.match(markdown, /Excerpt: "Adoption is slow among small firms\."/);
  assert.ok(!markdown.includes('EVID-2222222222'), 'only the strongest evidence is carried');
});

test('the verb table is filtered to the states the section actually asserts', () => {
  const { markdown } = context();
  assert.match(markdown, /\| supported \| shows, provides evidence for/);
  assert.ok(!markdown.includes('| canonical |'));
  assert.ok(!markdown.includes('| rejected |'));
});

test('a voice profile is summarised, and its absence is stated rather than hidden', () => {
  assert.match(context().markdown, /No author voice profile is active/);

  const { markdown } = context({
    profile: {
      id: 'a-researcher',
      learned: { meanSentenceLength: 24.1, firstPersonRate: 0.12 },
      terminology: { preserve: ['adoption lag'], avoid: ['leverage'] },
    },
  });
  assert.match(markdown, /Profile: a-researcher/);
  assert.match(markdown, /- firstPersonRate: 0\.12/);
  assert.match(markdown, /Preserve: adoption lag/);
  assert.match(markdown, /Avoid: leverage/);
});

test('the writing policy is carried when there is one', () => {
  const { markdown } = context({
    policy: {
      writing: { language: 'en', tone: { academic: true }, avoid: ['generic_ai_phrases'] },
    },
  });
  assert.match(markdown, /- Tone academic: true/);
  assert.match(markdown, /- Avoid: generic_ai_phrases/);
});

test('the budget drops the lowest-priority items first and records every one', () => {
  const full = context();
  const upToClaim = full.included.slice(0, 3).reduce((sum, item) => sum + item.chars, 0);

  const tight = context({ budgetChars: upToClaim });
  assert.deepEqual(
    tight.included.map((item) => item.kind),
    ['instruction', 'facts', 'claim'],
  );
  assert.deepEqual(
    tight.truncated.map((item) => item.kind),
    ['bibkeys', 'policy', 'voice', 'epistemic'],
  );
  assert.ok(tight.markdown.length <= upToClaim + 10, 'the joined markdown stays near the budget');
});

test('the task instruction survives a budget too small for anything', () => {
  const result = context({ budgetChars: 1 });
  assert.deepEqual(
    result.included.map((item) => item.kind),
    ['instruction'],
  );
  assert.equal(result.truncated.length, 6);
});

test('the default budget is a character count, and a small context fits inside it', () => {
  assert.equal(DEFAULT_BUDGET_CHARS, 12000);
  const result = context();
  assert.deepEqual(result.truncated, []);
  assert.ok(result.markdown.length < DEFAULT_BUDGET_CHARS);
});

test('an unknown section is null rather than an empty context', () => {
  assert.equal(assembleContext(snapshot(), 'appendix', {}), null);
});

test('the same context is assembled twice for the same workspace', () => {
  assert.equal(context().markdown, context().markdown);
});

test('sectionClaims prefers the plan, then the claims naming the section, then the questions', () => {
  const base = snapshot();
  const section = base.manuscript.sections[0];

  assert.deepEqual(
    sectionClaims(section, base).map((c) => c.id),
    ['CLAIM-1111111111'],
    'the claim names Introduction in its own sections list',
  );

  const other = { ...CLAIM, id: 'CLAIM-2222222222', sections: ['Results'] };
  const planned = {
    ...base,
    claims: [CLAIM, other],
    manuscript: {
      ...base.manuscript,
      sections: [{ ...section, claims: ['CLAIM-2222222222'] }],
    },
  };
  assert.deepEqual(
    sectionClaims(planned.manuscript.sections[0], planned).map((c) => c.id),
    ['CLAIM-2222222222'],
    "the plan outranks the claim's own list",
  );

  const byQuestion = {
    ...base,
    claims: [{ ...CLAIM, sections: [] }],
    manuscript: {
      ...base.manuscript,
      sections: [{ ...section, questions: ['RQ-1'] }],
    },
  };
  assert.deepEqual(
    sectionClaims(byQuestion.manuscript.sections[0], byQuestion).map((c) => c.id),
    ['CLAIM-1111111111'],
  );

  const candidate = {
    ...byQuestion,
    claims: [{ ...CLAIM, sections: [], state: 'candidate' }],
  };
  assert.deepEqual(
    sectionClaims(candidate.manuscript.sections[0], candidate),
    [],
    'the question fallback only carries supported and canonical claims',
  );
});

test('a section with nothing recorded says so rather than carrying an empty table', () => {
  const bare = snapshot({ claims: [] });
  const result = assembleContext(bare, 'introduction', { bibkeys: BIBKEYS });
  assert.ok(!result.included.some((item) => item.kind === 'claim'));
  assert.match(result.markdown, /No claims are attached to this section/);
});
