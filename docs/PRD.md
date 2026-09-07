# PhDude

## Product Requirements Document

**Version:** 1.2  
**Status:** Product Definition (v1.1 + Human Academic Writing, Skill-First Standardization)  
**License:** MIT  
**Product Type:** Free and open-source AI research harness  
**Primary Interfaces:** Claude Code, Codex, and compatible coding agents

**Changes in 1.2:** Human Academic Writing added as a core principle and Writing Engine requirement; Academic Epistemic Precision linked to Evidence & Provenance; Author Voice Profiles extended (`authors/`); `academic-prose` skill and `/phdude deslop`; explicit prohibition of AI-detection evasion; Academic Prose Quality (explainable); Writing Pipeline quality gates; Skill-First Standardization (CORE / SKILLS / PACKS / ADAPTERS); Skill Portability (`SKILL.md` convention); External Skills; Competitive Product Principle; Philosophy additions. All v1.1 decisions are preserved.

---

# 1. Executive Summary

**PhDude is the senior researcher in your terminal.**

PhDude is a free, open-source, field-agnostic research co-author harness for AI coding agents.

It transforms general-purpose coding agents such as Claude Code and Codex into persistent, evidence-aware, publication-minded research collaborators capable of helping individuals and teams manage the complete research lifecycle:

**Research idea → literature → evidence → methodology → data → analysis → figures → writing → review → formatting → thesis/paper → submission.**

PhDude is not intended to simply generate academic text.

Its purpose is to help researchers produce **better, more rigorous, traceable, reproducible, current, and publishable research**.

PhDude should behave like an experienced research colleague who:

- understands the complete research project;
- remembers previous research decisions;
- proactively identifies weaknesses;
- searches for recent literature;
- challenges unsupported assumptions;
- verifies evidence;
- recommends better methods;
- helps analyze data;
- generates reproducible figures and tables;
- writes using configurable academic styles, in a deliberate human academic voice rather than generic model prose;
- works inside official document templates;
- adapts manuscripts to venues such as IEEE and ACM;
- reviews the project like a demanding peer reviewer;
- and continuously recommends the highest-value next step.

Multiple researchers must be able to work with the **same PhDude workspace**, maintaining one shared and version-controlled research state.

PhDude must make no assumptions about the research discipline.

It should support research in areas including, but not limited to:

- computer science;
- medicine;
- engineering;
- economics;
- business;
- psychology;
- social sciences;
- law;
- humanities;
- biology;
- education;
- mathematics;
- interdisciplinary research.

Domain-specific knowledge must be introduced through composable extensions rather than hardcoded into the core.

---

# 2. Product Positioning

## Tagline

**The senior researcher in your terminal.**

Supporting line:

**Your AI can write. PhDude helps make the research worth publishing.**

## Product Category

PhDude is not:

- a chatbot;
- a citation generator;
- a PDF chat application;
- a literature-search website;
- a thesis generator;
- a proprietary research SaaS;
- or another AI text editor.

PhDude is a:

> **Research Co-Author Harness for AI Agents**

It provides persistent research context, policies, skills, memory, evidence structures, workflows, methodological awareness, and quality controls around existing AI coding agents.

## Competitive Product Principle

Individual research agents and skills are good at completing isolated research tasks: one search, one summary, one analysis, one draft.

PhDude's differentiation is **owning the longitudinal research project**.

It maintains awareness of:

- what the project is trying to establish;
- what evidence exists;
- what is missing;
- what decisions have been made;
- what changed;
- what is stale;
- what contradicts current conclusions;
- what the team is currently working on;
- what publication requirements remain;
- what the highest-value next action is.

Therefore the core competitive capabilities are:

- persistent Research State;
- Research Graph;
- Evidence and Provenance;
- shared Git-native Workspace;
- research policies;
- Field, Method and Venue Packs;
- Research Health;
- `/phdude next`;
- incremental context;
- academic writing quality;
- the complete research-to-publication lifecycle.

A standalone skill can draft a section. Only a harness that remembers the project can tell you whether that section is still true.

---

# 3. Product Principles

## 3.1 Research Quality Over Text Generation

PhDude must never optimize primarily for producing more text.

It should optimize for:

- stronger evidence;
- better methodology;
- reproducibility;
- clarity;
- traceability;
- publication quality.

---

## 3.2 Evidence Before Claims

Academic claims must be traceable whenever possible.

**No evidence → no academic claim presented as established fact.**

PhDude must distinguish between:

- established project facts;
- supported evidence;
- researcher interpretation;
- AI inference;
- hypotheses;
- candidate evidence;
- unresolved uncertainty.

---

## 3.3 Proactive Co-Authorship

PhDude is not a passive assistant.

It should proactively interrupt or recommend action when it detects:

- weak evidence;
- methodological flaws;
- contradictions;
- missing literature;
- outdated literature;
- unsupported claims;
- suspicious statistics;
- inconsistent project information;
- missing experiments;
- stronger analytical methods;
- publication opportunities;
- formatting violations;
- reproducibility problems;
- generic AI-writing patterns in manuscript prose.

---

## 3.4 Human Authority

PhDude may recommend changes but must not silently redefine fundamental research decisions.

Explicit approval is required before modifying canonical:

- research questions;
- hypotheses;
- variables;
- methodology;
- sample definitions;
- accepted results;
- canonical claims;
- approved manuscript text.

---

## 3.5 Field Agnosticism

PhDude Core must contain no hard-coded assumptions about academic discipline.

The core must not assume that research necessarily contains:

- p-values;
- experiments;
- datasets;
- surveys;
- Cronbach's alpha;
- machine-learning models;
- clinical populations;
- interviews;
- archival sources;
- laboratory measurements;
- statistical significance.

Instead, PhDude Core understands universal research concepts such as:

- questions;
- claims;
- evidence;
- sources;
- methods;
- results;
- artifacts;
- decisions;
- publications.

Field-specific behavior is supplied through extensions.

---

## 3.6 Methodological Pluralism

PhDude must not privilege one research paradigm.

It should support:

- quantitative research;
- qualitative research;
- mixed methods;
- experimental research;
- observational research;
- computational research;
- theoretical research;
- archival research;
- case studies;
- systematic reviews;
- meta-analysis;
- evidence synthesis;
- design science;
- research through practice;
- other valid research paradigms.

Field and methodology are independent dimensions.

---

## 3.7 Local-First

A PhDude research workspace must function without a mandatory proprietary cloud.

Researchers own:

- files;
- research history;
- evidence;
- manuscripts;
- metadata;
- configuration;
- author voice profiles.

---

## 3.8 Free and Open Source

The complete PhDude core must remain free and open source.

There must be:

- no required subscription;
- no required proprietary backend;
- no mandatory vendor;
- no model lock-in.

External services may exist as optional integrations only.

---

## 3.9 Model Agnostic

The research workspace must not belong to Claude, Codex, or another provider.

The same project should be usable by:

- Claude Code;
- Codex;
- OpenCode;
- Gemini CLI;
- Pi;
- future coding agents.

---

## 3.10 Token-Efficient by Architecture

> **PhDude should spend tokens thinking about research, not repeatedly reading and rewriting documents.**

PhDude must prefer:

- structured representations;
- incremental reads;
- cached extraction;
- dependency-aware context retrieval;
- section-level editing;
- content hashing;
- progressively disclosed skill guidance.

Full-document ingestion should not be repeated unless necessary.

---

## 3.11 Research Data Ownership

The canonical representation of a research project should use open and understandable formats wherever possible.

A user must be able to stop using PhDude without losing access to their research.

---

## 3.12 Engineering Simplicity

PhDude should be powerful because its architecture is composable, not because its runtime is complex.

Prefer:

**simple files + clear contracts + composable modules**

over:

**distributed infrastructure + hidden state + unnecessary abstractions.**

---

## 3.13 Human Academic Writing

PhDude must produce prose that reflects deliberate human academic reasoning rather than generic model-generated language.

It must optimize for specificity, intellectual clarity, epistemic precision, evidence alignment, natural structural variation and the configured author's academic voice.

The system should actively identify and revise generic LLM-writing patterns while preserving meaning, evidence and researcher intent.

The goal is writing quality and authorship consistency, not AI-detection evasion.

This is not an optional cosmetic feature. It is a core writing-quality requirement enforced by the Co-Author and Writing Engine (§29–§30c).

---

## 3.14 Skill-First, Not Skill-Only

Every recognizable research capability should normally be represented as a portable Skill.

The core runtime does not perform research tasks itself; it remembers, validates, protects and orchestrates.

**CORE** = what PhDude knows and remembers.
**SKILLS** = what PhDude knows how to do.
**PACKS** = how PhDude adapts to a field, method or venue.
**ADAPTERS** = how PhDude interacts with an agent or external system.

See §41a–§41c for the full rule.

---

# 4. Target Users

## Graduate Researchers

Master's and PhD students working on:

- theses;
- dissertations;
- academic papers.

## Academic Researchers

Researchers producing:

- journal articles;
- conference papers;
- systematic reviews;
- research reports.

## Technical Researchers

Researchers working with:

- code;
- experiments;
- datasets;
- ML/AI;
- computational research.

## Humanities and Qualitative Researchers

Researchers working with:

- primary sources;
- archives;
- interviews;
- field notes;
- qualitative coding;
- theoretical interpretation.

## Research Teams

Multiple researchers collaborating on the same:

- thesis project;
- laboratory project;
- paper;
- research program.

---

# 5. Core Jobs to Be Done

A user should be able to tell PhDude:

> Here is everything I currently have about my research. Understand it.

Then:

> Tell me what my current research actually says.

Then:

> Find the newest relevant research about this question.

Then:

> Tell me what evidence is missing.

Then:

> Help me design the methodology.

Then:

> Analyze these results.

Then:

> Generate the tables and figures.

Then:

> Write this section using my academic voice.

Then:

> This paragraph sounds like a chatbot wrote it. Fix it without changing what it claims.

Then:

> Put it into my university's Word template.

Then:

> Convert the paper to IEEE format.

Then:

> Review it as Reviewer #2.

Then:

> Tell me what I need to fix before submission.

And finally:

> What should we do next?

---

# 6. System Overview

PhDude consists of ten major systems:

```text
PhDude
│
├── 1. Research Workspace & Project State
├── 2. Knowledge Base
├── 3. Multimodal Ingestion Engine
├── 4. Fresh Research Engine
├── 5. Evidence & Provenance Engine
├── 6. Analysis & Visualization Engine
├── 7. Co-Author & Writing Engine
├── 8. Templates & Publication Profiles
├── 9. Review & Research Quality Engine
└── 10. Build, Export & Submission Engine
```

These operate under:

```text
Research Constitution
Research Policies
Writing Policies
Publication Policies
Field Packs
Method Packs
Venue Packs
Author Voice Profiles
User Preferences
Agent Skills
Workspace State
```

Conceptually, every component belongs to exactly one of four layers:

```text
CORE      what PhDude knows and remembers
          workspace state, canonical knowledge, provenance, permissions,
          context construction, caching, incremental invalidation,
          skill orchestration, approval gates, collaboration safety

SKILLS    what PhDude knows how to do
          literature search, evidence extraction, analysis, figures,
          academic writing, academic prose cleanup, Reviewer #2, …

PACKS     how PhDude adapts to a field, method or venue
          Field Packs, Method Packs, Venue Packs

ADAPTERS  how PhDude interacts with an agent or external system
          Claude Code, Codex, search providers, document tools, Git
```

---

# 7. Field-Agnostic Architecture

Field-specific behavior must never be embedded directly into PhDude Core.

Architecture:

```text
                   PhDude Core
                        │
         ┌──────────────┼───────────────┐
         │              │               │
     Research         Evidence        Writing
      Model          Provenance        Engine
         │              │               │
         └──────────────┼───────────────┘
                        │
              Extension Registry
                        │
        ┌───────────────┼────────────────┐
        │               │                │
   Field Packs      Method Packs    Venue Packs
                                  (Publication Profiles)
```

Examples:

```text
Field Packs
├── business
├── medicine
├── psychology
├── economics
├── law
├── humanities
├── computer-science
└── engineering
```

Method Packs:

```text
Method Packs
├── quantitative
├── qualitative
├── mixed-methods
├── experimental
├── systematic-review
├── meta-analysis
├── machine-learning
└── archival
```

Venue Packs (see §32) carry publication profiles such as IEEE, ACM or a university thesis format.

A project may compose several:

```yaml
project:
  fields:
    - business
    - artificial-intelligence

  methods:
    - quantitative

  venues:
    - ieee

  outputs:
    - thesis
    - journal-paper
```

---

# 8. Research Packs

Packs may contribute:

- domain terminology;
- methodology guidance;
- additional schemas;
- research-quality rules;
- specialized reviewers;
- search strategies;
- analytical skills;
- reporting standards;
- validation rules;
- discipline-appropriate writing conventions (terminology, epistemic verb norms, citation density expectations).

Example:

```yaml
pack: machine-learning

reviewers:
  - experimental-design
  - benchmark-integrity
  - reproducibility

recommended_checks:
  - baseline-comparison
  - ablation-analysis
  - error-analysis

writing:
  epistemic_norms:
    - "report results as observed on the evaluated benchmarks; do not generalize beyond them"
```

PhDude Core must work without any specialized pack.

---

# 9. Pack Detection

During bootstrap, PhDude may recommend packs.

Example:

```text
Detected research characteristics

Fields:
Business / Management
Artificial Intelligence

Method:
Quantitative

Recommended packs:
✓ business
✓ artificial-intelligence
✓ quantitative

Apply recommendations? [user decision]
```

Detection must never silently alter canonical project configuration.

---

# 10. Shared Research Workspace

Collaboration is a first-class requirement.

Multiple researchers must be able to run PhDude against the same project.

```text
Researcher A ─ Claude Code ─┐
                            │
Researcher B ─ Codex ───────┼── Shared PhDude Workspace
                            │
Researcher C ─ OpenCode ────┘
```

---

# 11. Git as Canonical Collaboration Layer

The shared Git repository is the canonical research workspace.

Git provides:

- distributed access;
- history;
- attribution;
- branches;
- review;
- rollback;
- collaboration;
- conflict visibility.

Compatible remotes include:

- GitHub;
- GitLab;
- Gitea;
- self-hosted Git;
- local/network Git repositories.

No provider is required.

---

# 12. Collaboration Model

Significant PhDude-generated changes should preserve authorship.

```yaml
actor:
  researcher: researcher-a
  agent: claude-code
  timestamp: ...
```

Research decisions may contain:

```yaml
decision: DEC-031

proposed_by:
  researcher: researcher-a
  agent: claude-code

approved_by:
  - researcher-a
  - researcher-b

change:
  hypothesis: H2
```

---

# 13. Collaboration-Safe Storage

Avoid giant shared state files.

Bad:

```text
knowledge.json
```

Preferred:

```text
knowledge/
├── claims/
├── papers/
├── evidence/
├── results/
└── decisions/
```

Each entity should normally exist independently.

Benefits:

- smaller diffs;
- fewer merge conflicts;
- clearer provenance;
- easier partial reads;
- easier agent context selection.

Append-only structures should be preferred for historical events.

---

# 14. Research Constitution

Every project includes:

```text
.phdude/
├── constitution.yaml
├── research-policy.yaml
├── writing-policy.yaml
├── citation-policy.yaml
├── methodology-policy.yaml
├── publication-policy.yaml
└── author-profile.yaml        # default/project voice; per-researcher profiles live in authors/
```

Example:

```yaml
principles:

  epistemic_integrity:
    - never fabricate citations
    - distinguish evidence from inference
    - disclose meaningful uncertainty
    - prefer primary evidence

  research:
    - challenge weak assumptions
    - identify contradictions
    - recommend stronger evidence

  reproducibility:
    - preserve analysis lineage
    - results should originate from reproducible analysis

  writing:
    - language strength must match evidence strength
    - prefer specific, research-grounded wording over generic prose
    - never optimize prose for AI-detector evasion

  authorship:
    - researchers retain final authority
```

---

# 15. Configurable Research Policy

Researchers must be able to specify search requirements.

```yaml
research:
  year_range:
    from: 2021

  peer_reviewed: preferred

  quartiles:
    allowed:
      - Q1
      - Q2

  languages:
    - en
    - es

  regions:
    priority:
      - Latin America

  freshness:
    always_check_recent: true

  preprints:
    require_approval: true
```

Policies may apply:

- globally;
- per workspace;
- per research question;
- per search.

---

# 16. Multimodal Ingestion

PhDude should ingest:

- PDF;
- DOCX;
- PPTX;
- XLSX;
- CSV;
- Markdown;
- TXT;
- BibTeX;
- RIS;
- LaTeX;
- relevant images.

Existing materials may include:

- academic papers;
- theses;
- university documents;
- presentations;
- reports;
- datasets;
- questionnaires;
- statistical exports;
- manuscript drafts;
- bibliographies;
- previously approved writing samples (for voice calibration, §30).

---

# 17. Bootstrap Existing Research

Core workflow:

```text
/phdude bootstrap
```

Pipeline:

```text
DISCOVER
   ↓
INVENTORY
   ↓
DEDUPLICATE
   ↓
CLASSIFY
   ↓
EXTRACT
   ↓
VERSION DETECTION
   ↓
ENTITY EXTRACTION
   ↓
CONTRADICTION DETECTION
   ↓
CANONICAL RESEARCH STATE
```

---

# 18. Knowledge Base

Primary universal domain objects:

```text
Artifact
Source
Paper
Claim
Evidence
ResearchQuestion
Objective
Hypothesis
Method
Result
Figure
Table
Citation
Template
Decision
ManuscriptSection
AuthorProfile
```

Extensions may define additional objects.

For example:

```text
ML pack:
Dataset
Model
Baseline
Metric
Experiment

Clinical pack:
Population
Intervention
Comparator
Outcome

Humanities pack:
PrimarySource
Archive
Interpretation
HistoricalClaim
```

---

# 19. Knowledge States

```text
CANONICAL
SUPPORTED
CANDIDATE
DISPUTED
REJECTED
```

The epistemic state must be explicit.

---

# 20. Evidence Graph

Example:

```text
PAPER-031
    ↓
EVIDENCE-015
    ↓
CLAIM-042
    ↓
SECTION-2.3
```

Empirical lineage:

```text
DATASET-03
    ↓
ANALYSIS-09
    ↓
RESULT-17
    ↓
CLAIM-51
    ↓
FIGURE-08
    ↓
SECTION-4.2
```

The same graph drives language strength: the wording of SECTION-2.3 about CLAIM-042 must be calibrated to the design and strength recorded on EVIDENCE-015 (§30a).

---

# 21. Research Lineage

Researchers should be able to ask:

> Where did this value come from?

or:

> Why did we make this argument?

or:

> Why does this sentence say "suggests" and not "shows"?

PhDude should trace through evidence and transformations.

---

# 22. Fresh Research Engine

PhDude should conduct current research using available adapters.

Possible providers include:

- Crossref;
- OpenAlex;
- Semantic Scholar;
- arXiv;
- PubMed;
- institutional repositories;
- web search;
- community integrations.

No proprietary provider is mandatory.

---

# 23. Freshness Awareness

```text
/phdude freshness
```

PhDude should detect stale literature searches and potentially material new research.

---

# 24. Proactive Research Recommendations

PhDude should proactively surface:

- methodological weaknesses;
- weak claims;
- missing literature;
- contradictory findings;
- outdated evidence;
- stronger methods;
- additional experiments;
- publication opportunities;
- manuscript prose whose language strength exceeds its evidence.

---

# 25. Research Memory

PhDude must remember research decisions.

Example:

```text
Why did we reject Method A?
```

should resolve against the historical decision graph.

---

# 26. Analysis Engine

PhDude should use analysis tools appropriate to the selected methodology and field.

The core must not assume statistics are necessary.

Possible capabilities include:

- descriptive statistics;
- regression;
- reliability analysis;
- qualitative coding;
- ML evaluation;
- experimental comparison;
- thematic analysis;
- evidence synthesis;
- other pack-provided methods.

PhDude must:

1. understand the question;
2. inspect available evidence;
3. recommend appropriate methods;
4. explain assumptions;
5. perform reproducibly when executable;
6. verify output;
7. identify limitations.

---

# 27. Figures, Charts and Visualization

PhDude must support publication-quality:

- charts;
- statistical visualizations;
- conceptual frameworks;
- methodological diagrams;
- flowcharts;
- PRISMA diagrams;
- timelines;
- matrices;
- architecture diagrams;
- multi-panel figures.

Prefer reproducible figures.

```yaml
id: FIG-007

generated_from:
  - RESULT-017

generator:
  - scripts/figures/fig_007.py
```

Output:

- SVG;
- PDF;
- PNG;
- venue-required formats.

---

# 28. Academic Tables

Support:

- descriptive tables;
- statistical tables;
- literature matrices;
- experimental comparisons;
- qualitative coding summaries;
- domain-specific tables.

Targets:

- Markdown;
- LaTeX;
- DOCX;
- CSV;
- XLSX.

---

# 29. Co-Author Writing Engine

Writing context should be assembled from:

```text
Relevant Research State
+
Relevant Claims
+
Evidence
+
Target Section
+
Writing Policy
+
Author Voice Profile
+
Publication Profile
```

Avoid full-project reads by default.

## 29.1 Human Academic Writing Requirement

The Writing Engine must produce prose that reads as deliberate, credible human academic writing rather than generic LLM-generated text. This is a core writing-quality requirement, not a style preference.

The engine must optimize for:

- intellectual clarity;
- specificity;
- evidence alignment;
- epistemic precision;
- appropriate academic restraint;
- natural sentence and paragraph variation;
- discipline-appropriate terminology;
- coherent argumentation;
- concise academic language;
- consistency with the configured author's voice.

PhDude must explicitly avoid common forms of AI-generated writing slop, including:

- generic LLM filler;
- repetitive rhetorical structures;
- formulaic paragraph construction;
- repetitive sentence lengths or openings;
- unnecessary summary sentences;
- excessive transitions such as "Furthermore", "Moreover", "Additionally";
- inflated importance or significance;
- unsupported adjectives;
- vague claims about "the literature";
- ungrounded claims of novelty;
- empty phrases such as "it is important to note";
- excessive hedging;
- excessive certainty;
- fake specificity;
- generic conclusions;
- rhetorical padding;
- overuse of symmetrical lists;
- mechanical introductions and conclusions;
- phrases that sound polished but communicate little information.

PhDude must prefer concrete and research-specific language.

Rather than:

> "Recent studies have increasingly demonstrated the significant importance of artificial intelligence in modern organizations."

PhDude should prefer something grounded and specific such as:

> "Recent empirical studies associate AI adoption with changes in firm-level decision processes and internationalization capabilities [citations]."

**The system must never introduce specificity that is not supported by evidence merely to make prose sound more human.** Every concrete detail added during drafting or revision must resolve to a Claim, Evidence, Result or Fact in the workspace, or be marked as researcher-supplied.

## 29.2 Writing Pipeline

The Writing Engine runs explicit quality gates:

```text
Research State
      ↓
Relevant Evidence
      ↓
Draft
      ↓
Citation Audit
      ↓
Evidence Fidelity Check
      ↓
Academic Prose Skill
      ↓
Author Voice Check
      ↓
AI-Slop Audit
      ↓
Meaning Preservation Check
      ↓
Venue/Profile Validation
      ↓
Final Manuscript
```

Rules:

- Do not blindly rewrite text at every stage. Each gate operates on the smallest unit that changed (section or paragraph) and reports findings; rewriting happens only where a gate fails.
- Already approved text (§3.4) is preserved unless the researcher explicitly reopens it.
- Transformations are section-level and incremental (§34–§36); an unchanged section is not re-run through the pipeline.
- Each gate is itself a Skill (§41a) with a declared contract; the core orchestrates the order, the context budget and the approval gates.
- The Meaning Preservation Check compares claims, citations, numbers, and hedging level before and after every prose transformation and blocks changes that alter any of them.

---

# 30. Author Voice Profiles

Writing style must be configurable.

```yaml
writing:
  language: en

  tone:
    academic: true
    concise: true
    assertiveness: moderate

  avoid:
    - generic_ai_phrases
    - unsupported_superlatives
    - rhetorical_filler
```

Approved writing samples may be used to calibrate voice.

## 30.1 Per-Researcher Profiles

Each researcher may define an academic writing profile in the workspace:

```text
authors/
  researcher-a.yaml
  researcher-b.yaml
```

An author profile may include:

- preferred language;
- academic tone;
- sentence-length tendencies;
- paragraph density;
- preferred terminology;
- level of assertiveness;
- first-person usage;
- preferred transition style;
- terminology to preserve;
- wording to avoid;
- examples of previously approved writing.

Example:

```yaml
schema: phdude.author-profile
version: 1
id: researcher-a
language: en
tone:
  academic: true
  assertiveness: moderate
  first_person: sparing        # never | sparing | natural
sentences:
  length: varied               # short | varied | long
  openings: varied
paragraphs:
  density: medium
transitions: minimal
terminology:
  preserve: [internationalization capability, decision process]
  avoid: [leverage, robust, cutting-edge]
samples:
  - path: authors/samples/researcher-a/chapter-2-approved.md
    approved: true
```

PhDude should be able to learn writing characteristics from researcher-approved writing samples. Learned characteristics are stored as explicit, human-readable profile fields (never as opaque embeddings in canonical state) so a researcher can inspect and correct what PhDude inferred.

The goal is not to impersonate a person. The goal is to preserve stylistic continuity and avoid generic model prose.

## 30.2 Manuscript Voice

A manuscript may define:

```yaml
writing:
  primary_voice: researcher-a
```

or:

```yaml
writing:
  voice: project-consensus
```

`project-consensus` is a profile derived from the participating authors' profiles plus explicit team decisions (recorded as Decisions, §12), so that collaborative projects where multiple researchers contribute still produce a manuscript in one agreed academic voice.

The Author Voice Check gate (§29.2) validates drafted or revised text against the active voice profile and reports deviations rather than silently rewriting.

---

# 30a. Academic Epistemic Precision

PhDude must distinguish carefully between verbs and formulations such as:

- demonstrates;
- shows;
- indicates;
- suggests;
- is associated with;
- predicts;
- causes;
- is consistent with;
- provides evidence for.

The wording must reflect the strength and type of underlying evidence. Correlational evidence must not automatically be described as causal. A single small-sample study does not "demonstrate"; a well-powered replicated finding is not merely "suggested".

Claims must be calibrated to:

- research design;
- evidence strength;
- sample;
- methodology;
- source quality;
- uncertainty.

Academic prose quality is therefore linked to the Evidence and Provenance system (§20–§21, §37): the Evidence Fidelity Check and the Academic Prose Skill read the design, strength and state recorded on the supporting Evidence and Claim objects and select or validate the epistemic formulation accordingly. Field and Method Packs may refine the vocabulary and norms (§8) without changing the core rule:

**Evidence determines language strength.**

---

# 30b. Academic Prose Skill

The Human Academic Writing capability is implemented as a first-class PhDude Skill named `academic-prose`.

Suggested structure:

```text
skills/
  academic-prose/
    SKILL.md
    references/
      academic-style.md
      ai-writing-patterns.md
      epistemic-language.md
      voice-matching.md
      examples.md
    scripts/
      prose-lint.mjs
    tests/
      academic.yaml
      ai-slop.yaml
      human-writing.yaml
```

It follows the Skill Specification (§41b) and declares:

- inputs (manuscript section or text, target claims and evidence, active voice profile, publication profile);
- outputs (revised text, findings, explainable quality report);
- workspace reads (`manuscript/`, `knowledge/claims`, `knowledge/evidence`, `authors/`, `.phdude/writing-policy.yaml`);
- workspace writes (only `manuscript/` sections, only through the approval gate);
- policies (writing policy, citation policy, constitution);
- quality gates (evidence fidelity, voice, AI-slop, meaning preservation);
- permissions (no network; workspace read/write as listed);
- dependencies (none beyond the core runtime; `prose-lint.mjs` is deterministic Node);
- tests (fixture-based: text that must pass, text that must be flagged, before/after pairs).

`prose-lint.mjs` is the deterministic part: it detects surface patterns (transition density, sentence-length monotony, banned phrases, unsupported intensifiers, vague literature references, sentence-opening repetition) and produces explainable observations with locations. Judgment-based revision remains agent work guided by the references, under the Meaning Preservation Check.

The skill is compatible with progressive disclosure: `SKILL.md` carries the operating rules and the index of references; references are loaded only when the task needs them (e.g. `voice-matching.md` only when a voice profile is active). Agents must not load all writing guidance into context by default.

## `/phdude deslop`

User-facing alias:

```text
/phdude deslop [section|file|manuscript]
```

It invokes the `academic-prose` skill to inspect a manuscript or section for generic AI-writing patterns and propose or perform revisions while preserving:

- meaning;
- evidence;
- citations;
- argumentation;
- author terminology;
- factual accuracy.

Default behavior proposes a diff per section; applying it requires researcher approval (§3.4). It must never optimize for fooling AI detectors. Its purpose is academic writing quality.

---

# 30c. Prohibited Goal: AI Detection Evasion

**PhDude must not optimize writing to bypass, evade, manipulate or game AI-detection systems.**

The objective is:

- better academic prose;
- clearer authorship;
- greater specificity;
- stronger argumentation;
- reduced generic LLM language.

"AI detector score" must not be used as a quality metric, a test oracle, a skill input, or a Research Health dimension. Skills, packs or external skills that declare detector evasion as a purpose must be rejected by the skill loader.

---

# 31. Document Templates

Templates are first-class assets.

```text
templates/
├── university/
├── journals/
├── conferences/
├── presentations/
└── custom/
```

Supported:

- DOCX;
- PPTX;
- XLSX;
- LaTeX;
- Markdown.

PhDude should preserve template formatting whenever possible.

---

# 32. Publication Profiles and Venue Packs

Profiles may include:

```text
IEEE
ACM
APA
Springer
Elsevier
Nature
Vancouver
University-specific formats
```

Profiles may define:

- manuscript structure;
- citation style;
- page constraints;
- abstract rules;
- headings;
- figures;
- tables;
- references;
- supplementary material;
- venue-specific writing conventions (e.g. abstract tense, first-person policy, terminology).

A Publication Profile is delivered as a **Venue Pack**, the third pack kind alongside Field and Method Packs (§7, §104). A Venue Pack may bundle a profile, templates, a submission checklist and venue-specific reviewer skills.

Current venue requirements should be verified when necessary rather than blindly hardcoded.

---

# 33. Canonical Manuscript Architecture

Rendered files are outputs, not research truth.

Preferred:

```text
manuscript/
├── manuscript.yaml        # voice, target venue, section order
├── abstract.md
├── introduction.md
├── methods.md
├── results.md
├── discussion.md
└── conclusions.md

references.bib
```

Build:

```text
Canonical Research
        +
Publication Profile
        +
Template
        ↓
DOCX / PDF / LaTeX
```

---

# 34. Efficient Document Intelligence

Heavy files should normally be parsed once.

```text
thesis.docx
      ↓
Structured Extraction
      ↓
Local Cache
```

Example:

```text
.phdude/cache/thesis/
├── manifest.json
├── sections/
├── tables/
├── figures/
└── styles.json
```

Tasks load only required regions.

---

# 35. Content Hashing

Every ingested artifact should support content identity.

```yaml
artifact: ART-023
hash: abc123
```

Unchanged content should not be reprocessed.

Section-level hashing should be used where practical. Writing-pipeline gate results (§29.2) are cached per section hash so an unchanged section is not re-audited.

---

# 36. Research Dependency Graph

```text
PAPER-083
   ↓
CLAIM-044
   ↓
SECTION-2.3
   ↓
TABLE-04
   ↓
paper.pdf
```

Changes should invalidate only affected dependencies. A change in the strength or state of EVIDENCE-015 invalidates the epistemic-precision result of every section that cites the claims it supports.

---

# 37. Citation Engine

PhDude should verify:

- citation existence;
- metadata;
- DOI or persistent identifiers;
- source-to-claim support;
- bibliography consistency;
- appropriate placement;
- evidence freshness;
- that the sentence's epistemic formulation matches the cited evidence (§30a).

---

# 38. Consistency Engine

PhDude should identify conflicting facts across artifacts.

Example:

```text
Sample Size

THESIS.docx       312
DEFENSE.pptx      300
RESULTS.xlsx      312

⚠ CONFLICT DETECTED
```

Canonical resolution requires researcher approval.

---

# 39. Research Health

```text
/phdude health
```

Dimensions may include:

```text
Literature Coverage
Evidence Strength
Methodological Integrity
Citation Quality
Freshness
Reproducibility
Consistency
Academic Prose Quality
```

Scores must always be explainable.

## 39.1 Academic Prose Quality

An explainable quality assessment of manuscript prose.

Example:

```text
Academic Prose Quality: 91/100

Specificity             94
Evidence Alignment      98
Epistemic Precision     90
Structural Variation    84
Author Voice            92
Conciseness             88

Warnings:

- 2 vague literature claims
- 1 unsupported intensifier
- paragraph 14 contains repetitive sentence structure
```

Requirements:

- Every sub-score is derived from concrete, located observations (file, section, paragraph, sentence) that the researcher can open and dispute.
- Evidence Alignment and Epistemic Precision are computed against the Evidence Graph, not against the text alone.
- Author Voice is computed against the active voice profile (§30).
- Opaque or arbitrary "humanity" scores are forbidden; so is any detector-derived score (§30c).
- The exact scoring implementation does not need to exist in v0.1, but the architecture must allow it: gate findings are stored as structured observations keyed by section hash, and Research Health aggregates them.

---

# 40. Review Modes

```text
/phdude lite
/phdude full
/phdude ruthless
/phdude off
```

## Lite

Complete the task and flag serious concerns.

## Full

Default proactive research co-author.

## Ruthless

Adversarial senior reviewer. In ruthless mode the AI-Slop Audit and Epistemic Precision gates block rather than warn.

---

# 41. Reviewer Skills

Possible specialized skills:

- Methodologist;
- Statistician;
- Citation Auditor;
- Reviewer #2;
- Reproducibility Reviewer;
- Publication Strategist;
- Academic Prose Reviewer;
- domain reviewers supplied by packs.

Prefer skills over permanently-running autonomous agents.

---

# 41a. Skill-First Standardization

PhDude is **skill-first, not skill-only**.

Every recognizable research capability should normally be represented as a portable Skill. Examples:

- literature search;
- literature review;
- evidence extraction;
- citation verification;
- methodological review;
- data analysis;
- figure generation;
- table generation;
- academic writing;
- academic prose cleanup;
- Reviewer #2;
- venue adaptation;
- submission readiness.

The core runtime remains responsible for:

- workspace state;
- canonical knowledge;
- provenance;
- permissions;
- context construction;
- caching;
- incremental invalidation;
- skill orchestration;
- approval gates;
- collaboration safety.

Use this distinction throughout the technical architecture:

```text
CORE     = what PhDude knows and remembers.
SKILLS   = what PhDude knows how to do.
PACKS    = how PhDude adapts to a field, method or venue.
ADAPTERS = how PhDude interacts with an agent or external system.
```

A capability that needs no memory, no provenance and no approval gate is a Skill. Anything that must be true tomorrow for another researcher on another agent belongs in Core.

---

# 41b. Skill Specification and Portability

Where practical, PhDude Skills follow the open Agent Skills convention: a directory with `SKILL.md` (YAML front matter + Markdown instructions) and progressively loaded resources (`references/`, `scripts/`, `tests/`).

```text
skills/<name>/
├── SKILL.md
├── references/
├── scripts/
└── tests/
```

`SKILL.md` front matter carries the standard fields (`name`, `description`) and may be extended with research-specific contracts under a `phdude:` key:

```yaml
---
name: academic-prose
description: Revise manuscript prose for specificity, epistemic precision and author voice while preserving meaning.
phdude:
  version: 1
  reads: [manuscript/**, knowledge/claims/**, knowledge/evidence/**, authors/**, .phdude/writing-policy.yaml]
  writes: [manuscript/**]
  objects: [ManuscriptSection, Claim, Evidence, AuthorProfile]
  artifacts: [manuscript-section, prose-quality-report]
  evidence_requirements: claims-cited-in-text-must-resolve
  provenance: record-transformation
  approval_gates: [manuscript-write]
  quality_gates: [evidence-fidelity, author-voice, ai-slop-audit, meaning-preservation]
  permissions:
    network: none
    workspace: [read, write:manuscript]
  dependencies: []
  tests: tests/
---
```

Contract fields:

- reads / writes (workspace globs);
- evidence requirements;
- approval gates;
- provenance requirements;
- quality gates;
- network permissions;
- workspace permissions;
- supported research objects;
- generated artifacts;
- dependencies;
- tests.

Rules:

- Do not create an incompatible skill format unless absolutely necessary; a skill without a `phdude:` block is still loadable with default (read-only, no-network) permissions.
- Skills are Markdown plus optional deterministic scripts; they carry no runtime of their own.
- Progressive disclosure is mandatory: the core loads `SKILL.md`, and references are loaded on demand under the context budget (§70).
- The core validates the `phdude:` block against a JSON Schema and enforces the declared permissions (§72, §76).

---

# 41c. External Skills

PhDude should eventually be able to consume compatible research skills written by third parties.

```text
PhDude Skills
      +
Community Skills
      +
Compatible external research skills
      ↓
Same Research Workspace
```

They operate against the same Research Workspace when their permissions and contracts allow it. The loader:

- accepts the open `SKILL.md` convention;
- applies default least-privilege permissions to skills without a `phdude:` block;
- requires explicit installation (§76; no silent remote loading);
- rejects skills whose declared purpose violates the constitution (e.g. detector evasion, §30c).

PhDude should aim to become the best environment for running research skills, not merely a closed collection of first-party skills.

---

# 42. Submission Readiness

```text
/phdude ready
```

Evaluate research, methodology, evidence, formatting, figures, tables, references, prose quality and submission requirements.

---

# 43. Venue Adaptation

```text
/phdude adapt --to ieee
```

PhDude should adapt:

- structure;
- page limits;
- abstract;
- terminology;
- figures;
- tables;
- bibliography;
- supplementary materials.

Not merely change citation formatting. Adaptation runs through the Writing Pipeline gates (§29.2) so meaning and evidence survive the transformation.

---

# 44. Core Commands

```text
/phdude
/phdude lite|full|ruthless|off

/phdude bootstrap
/phdude ingest

/phdude research
/phdude research-fresh
/phdude review
/phdude knowledge
/phdude gaps
/phdude freshness

/phdude analyze
/phdude figure
/phdude table

/phdude write
/phdude deslop
/phdude template
/phdude adapt

/phdude audit
/phdude redteam
/phdude health
/phdude ready

/phdude status
/phdude next
```

---

# 45. Killer Command: `/phdude next`

PhDude should identify the highest-impact next action.

Example:

```text
Highest-impact next action:

Update literature supporting RQ2.

Why:
- current search is 7 months old
- 3 central claims depend on it
- recent contradictory evidence exists

Expected impact:
HIGH
```

---

# 46. Software Architecture Philosophy

PhDude should follow a **modular monolith / lightweight harness architecture**.

It should borrow Ponytail's fundamental simplicity:

```text
Node.js
JavaScript ESM
npm
Markdown instructions/skills
hooks
thin host adapters
node:test
```

PhDude should not initially become a conventional web application.

The architecture must be optimized for:

- maintainability;
- extensibility;
- portability;
- auditability;
- low installation friction;
- low runtime complexity.

---

# 47. Clean Architecture

PhDude should use Clean/Hexagonal Architecture concepts pragmatically.

Logical layers:

```text
┌──────────────────────────────┐
│ Agent / CLI Adapters         │
├──────────────────────────────┤
│ Application / Use Cases      │
│ (skill orchestration, gates) │
├──────────────────────────────┤
│ Research Domain Core         │
├──────────────────────────────┤
│ Ports / Contracts            │
├──────────────────────────────┤
│ Infrastructure Adapters      │
└──────────────────────────────┘
```

Skills and Packs sit outside these layers as data (Markdown, YAML, deterministic scripts) consumed through the `ResearchSkill` and `ResearchPack` ports.

The domain core must not depend on:

- Claude;
- OpenAI;
- GitHub;
- Crossref;
- Pandoc;
- Zotero;
- a specific filesystem library;
- a specific academic provider;
- a specific skill's prose rules.

Infrastructure depends inward toward contracts.

---

# 48. Ports and Adapters

External capabilities must implement explicit ports.

Examples:

```text
SearchProvider
DocumentParser
DocumentRenderer
CitationResolver
AgentHost
VersionControlProvider
AnalysisRunner
ResearchPack
ResearchSkill
PublicationProfile
```

Implementations:

```text
SearchProvider
├── OpenAlexAdapter
├── CrossrefAdapter
├── SemanticScholarAdapter
└── WebSearchAdapter
```

Core workflows depend on `SearchProvider`, not a particular vendor.

---

# 49. Dependency Inversion

High-level research logic must not depend directly on low-level implementations.

Example:

Bad:

```text
ResearchEngine → SemanticScholarAPI
```

Correct:

```text
ResearchEngine → SearchProvider
                       ↑
              SemanticScholarAdapter
```

This principle applies to:

- agents;
- research search;
- documents;
- citation providers;
- storage;
- rendering;
- execution;
- skills.

---

# 50. Separation of Concerns

Modules must have clear responsibilities.

Examples:

```text
ingestion/
research/
knowledge/
evidence/
writing/
review/
publication/
workspace/
skills/
```

Document parsing should not contain research reasoning.

Research reasoning should not contain DOCX formatting.

Citation validation should not control Git.

Prose rules live in the `academic-prose` skill, not in the writing orchestrator.

---

# 51. SOLID Principles

Apply SOLID pragmatically.

### Single Responsibility

Each module should have one primary reason to change.

### Open/Closed

New:

- fields;
- methodologies;
- agents;
- venues;
- search providers;
- skills;

should normally be added through extension, not core modification.

### Liskov Substitution

Adapters implementing the same port must honor equivalent behavioral contracts.

### Interface Segregation

Avoid giant plugin interfaces.

An extension should implement only capabilities it requires.

### Dependency Inversion

Core research logic depends on abstractions.

---

# 52. KISS

Prefer the simplest architecture that meets current requirements.

Examples:

Prefer:

```text
YAML + Markdown + Git
```

before:

```text
Database + API + queue + distributed cache
```

when both satisfy the problem.

---

# 53. YAGNI

Do not implement infrastructure based solely on hypothetical future scale.

Examples intentionally excluded initially:

- microservices;
- Kubernetes;
- message brokers;
- CRDT collaboration;
- distributed caches;
- custom database servers;
- ML models for style scoring (deterministic linting plus agent judgment suffices).

Add infrastructure when real requirements justify it.

---

# 54. DRY, Carefully

Avoid duplicated business logic.

However, do not create abstractions merely to eliminate a small amount of repeated code.

Prefer:

> duplication over the wrong abstraction.

Particularly for early adapters whose behavior may diverge.

---

# 55. Composition Over Inheritance

PhDude extensions should compose:

```text
Field Pack
+
Method Pack
+
Venue Pack
+
Research Policy
+
Author Voice Profile
+
Skills
```

Avoid deep inheritance hierarchies.

---

# 56. Functional Core, Imperative Shell

Where practical:

- transformations;
- validation;
- dependency resolution;
- scoring;
- prose linting;

should be deterministic pure logic.

Side effects should exist at the edges:

- filesystem writes;
- network requests;
- agent execution;
- document rendering.

This improves:

- testing;
- determinism;
- reproducibility.

---

# 57. Stable Contracts

Public extension points require explicit contracts.

Contracts should use:

- JSON Schema;
- documented JavaScript interfaces;
- JSDoc types;
- fixture examples.

Never rely solely on undocumented object shapes.

---

# 58. Schema Versioning

Canonical research data must declare schema versions.

Example:

```yaml
schema: phdude.claim
version: 1
```

Breaking schema changes require migrations.

---

# 59. Migration Strategy

PhDude must support workspace upgrades.

Example:

```text
phdude migrate
```

Migrations must:

- be deterministic;
- preserve user information;
- make backups or use Git;
- be testable;
- report changes.

Existing research workspaces must not silently become incompatible.

---

# 60. Semantic Versioning

PhDude should follow SemVer:

```text
MAJOR.MINOR.PATCH
```

Breaking:

- plugin contracts;
- canonical schemas;
- CLI interfaces;
- skill contracts;

requires appropriate versioning.

---

# 61. Backward Compatibility

Stable interfaces should remain compatible across minor releases whenever practical.

Deprecations should include:

- warning;
- replacement;
- migration path;
- eventual removal version.

---

# 62. Idempotency

Operations should be idempotent when appropriate.

Running:

```text
/phdude ingest paper.pdf
```

twice should not create duplicate sources.

Running bootstrap repeatedly should converge on the same canonical state unless input changed.

Running `/phdude deslop` on already-clean text should produce no changes.

---

# 63. Determinism

Non-AI transformations should be deterministic whenever possible.

Examples:

- content hashing;
- IDs;
- dependency resolution;
- formatting;
- builds;
- schema validation;
- prose linting observations.

AI-produced operations must record relevant provenance.

---

# 64. Atomic Writes

Critical workspace state should use safe-write behavior.

Preferred:

```text
write temporary
→ validate
→ atomic rename
```

Avoid partial corruption if processes fail.

---

# 65. Concurrency Safety

Multiple researchers may update the same workspace.

PhDude must minimize conflicts through:

- entity-per-file storage;
- append-only events;
- Git branching;
- deterministic IDs;
- atomic writes;
- explicit canonical approval workflows.

PhDude should detect conflicting canonical changes rather than silently picking a winner.

---

# 66. Identifier Strategy

Research objects require stable identifiers.

Examples:

```text
CLAIM-...
EVID-...
PAPER-...
DEC-...
RESULT-...
FIG-...
```

IDs must remain stable when file names or display names change.

---

# 67. Incremental Processing

PhDude should process dependency deltas.

```text
Changed Source
      ↓
Affected Evidence
      ↓
Affected Claims
      ↓
Affected Sections
```

Do not rebuild unrelated research state.

---

# 68. Cache Architecture

Cache is:

- disposable;
- rebuildable;
- local by default;
- non-canonical.

Never place irreplaceable research information only in cache.

Structure:

```text
.phdude/cache/
```

Canonical state belongs elsewhere.

---

# 69. Performance

Primary performance goals:

- avoid repeated full-document parsing;
- reduce model context;
- use incremental builds;
- parallelize independent deterministic work where safe;
- avoid unnecessary external calls.

Optimize after measuring.

---

# 70. Token Efficiency

Every AI workflow should construct a **context budget**.

Priority order:

```text
1. task instruction
2. canonical project facts
3. directly relevant evidence
4. research policy
5. writing/methodology requirements
6. supporting context
```

Avoid automatically loading:

- complete PDFs;
- entire manuscripts;
- all knowledge objects;
- unrelated chats;
- every skill reference file (load `SKILL.md`; pull references on demand).

---

# 71. Security Model

PhDude may interact with confidential unpublished research.

Default principle:

> **Local and private unless explicitly configured otherwise.**

PhDude must not silently send research materials to external services.

---

# 72. Least Privilege

Adapters and skills should receive only required capabilities.

A citation-search plugin does not need write access to manuscripts.

A renderer does not need network credentials.

The `academic-prose` skill needs no network access.

---

# 73. Secrets Management

Never store:

- API keys;
- passwords;
- credentials;

inside canonical research files.

Use:

- environment variables;
- operating system credential stores;
- provider-native secret management.

`.env` files must be ignored by default.

---

# 74. Input Validation

All external inputs should be treated as untrusted.

Validate:

- plugin configuration;
- skill metadata;
- schemas;
- paths;
- URLs;
- filenames;
- document metadata;
- external API responses.

Protect against:

- path traversal;
- malformed data;
- unsafe command construction.

---

# 75. Command Execution Safety

Commands generated from research workflows must not be blindly shell-interpolated.

Prefer structured execution APIs.

Destructive operations require clear intent.

---

# 76. Plugin and Skill Security

Plugins and skills execute privileged research workflows.

PhDude should eventually support:

- manifest declarations;
- required permissions;
- version constraints;
- provenance;
- explicit installation.

No silent remote-code loading. Skill scripts run only with the permissions declared in `SKILL.md`.

---

# 77. Privacy

Research documents may contain:

- unpublished findings;
- confidential datasets;
- personal data;
- intellectual property;
- a researcher's personal writing samples.

PhDude should expose clearly when external processing is involved.

---

# 78. Error Handling

Errors must be:

- explicit;
- actionable;
- recoverable where possible.

Avoid swallowing errors.

Example:

Bad:

```text
Ingestion failed.
```

Better:

```text
Could not extract tables from PAPER-031.

Text extraction succeeded.
Tables remain unavailable.

Suggested action:
install the optional PDF table adapter
or inspect the document manually.
```

---

# 79. Graceful Degradation

Optional integrations should fail independently.

If a provider fails:

```text
Semantic Scholar unavailable
```

PhDude may continue with another configured provider where policy permits.

---

# 80. Structured Logging

Internal operations should support structured logs.

Example:

```json
{
  "operation": "ingest",
  "artifact": "ART-91",
  "status": "completed",
  "duration_ms": 513
}
```

Logs should not leak secrets or unnecessarily duplicate research content.

---

# 81. Observability

PhDude should make important workflows inspectable.

Potential commands:

```text
/phdude doctor
/phdude debug
```

Expose:

- adapter availability;
- cache status;
- schema versions;
- failed operations;
- dependency invalidations;
- loaded skills and their permissions.

---

# 82. Audit Trail

Important research changes must be auditable.

Especially:

- canonical claims;
- methodology changes;
- result approvals;
- evidence promotions;
- manuscript transformations (including every prose revision, with the gate results that allowed it).

Git history complements application-level provenance.

---

# 83. Testing Strategy

Testing should follow a pragmatic pyramid:

```text
Many unit tests
        ↓
Contract tests
        ↓
Integration tests
        ↓
A smaller number of end-to-end tests
```

Core runtime testing uses:

```text
node:test
```

Skills carry their own fixture tests (`skills/<name>/tests/`), run by the same runner.

---

# 84. Unit Tests

Required for:

- schema validation;
- graph operations;
- hashing;
- dependency resolution;
- migration logic;
- policies;
- parsers where deterministic;
- state transitions;
- prose-lint observations.

---

# 85. Contract Tests

Every adapter should run against a shared contract suite.

For example all SearchProviders must satisfy:

```text
query
filter
normalize
error behavior
```

Every skill's `SKILL.md` must validate against the skill schema, and its declared `tests/` must pass.

This prevents agent/provider-specific implementations from changing core semantics.

---

# 86. Integration Tests

Required for important boundaries:

- filesystem;
- Git;
- document parsers;
- renderers;
- search providers;
- agent adapters.

Network-dependent suites should be isolated.

---

# 87. Golden Tests

Academic outputs benefit from golden fixtures.

Examples:

```text
input research state
→ expected IEEE bibliography

input table model
→ expected LaTeX output

input DOCX template
→ expected preserved styles

input paragraph + evidence
→ expected prose-lint observations
```

Golden changes require intentional review.

---

# 88. End-to-End Fixtures

Maintain several example research projects:

```text
examples/
├── quantitative-social-science/
├── machine-learning/
├── qualitative-humanities/
└── generic-thesis/
```

This also verifies field agnosticism.

---

# 89. Regression Testing

Every fixed production bug should ideally add a test preventing recurrence.

---

# 90. CI

Every pull request should run:

```text
format checks
lint
unit tests
contract tests
selected integration tests
schema validation
skill validation
```

Main branch should remain releasable.

---

# 91. Code Formatting

Repository formatting must be automatic and consistent.

Use a standard formatter.

Contributors should not debate formatting in PR review.

---

# 92. Linting

Static analysis should catch:

- common bugs;
- suspicious patterns;
- unsafe constructs;
- unused code.

Linting belongs in CI.

---

# 93. Documentation as Part of the Product

Every public:

- command;
- schema;
- port;
- adapter;
- pack;
- profile;
- skill;

requires documentation.

---

# 94. Architecture Decision Records

Meaningful architectural decisions should be stored as ADRs.

```text
docs/adr/
├── 0001-node-esm.md
├── 0002-git-workspace.md
├── 0003-field-packs.md
├── 0004-skill-first.md
└── ...
```

Each records:

- context;
- decision;
- alternatives;
- consequences.

This is particularly important for an open-source project.

---

# 95. API Documentation

Extension APIs should include:

- contract;
- examples;
- lifecycle;
- error behavior;
- stability status.

---

# 96. Dependency Hygiene

Keep the core dependency tree intentionally small.

Before adding a dependency ask:

1. Is it necessary?
2. Is it maintained?
3. Can Node provide this functionality?
4. What security surface does it add?
5. Is it core or optional?

---

# 97. Supply-Chain Security

CI should eventually include:

- dependency vulnerability scanning;
- lockfile validation;
- release provenance;
- controlled npm publishing.

Do not execute untrusted package lifecycle scripts without consideration.

---

# 98. Cross-Platform Support

Core PhDude should target:

- macOS;
- Linux;
- Windows.

Avoid assuming Bash-specific behavior inside the core.

Host adapters may handle platform differences.

---

# 99. Portability

A research workspace should remain readable without PhDude.

Prefer:

```text
Markdown
YAML
JSON
JSONL
BibTeX
CSV
Git
```

over opaque proprietary stores.

---

# 100. Accessibility

PhDude initially operates through coding-agent interfaces, but generated outputs should avoid preventable accessibility issues.

Where relevant:

- figures should support descriptions/alt text;
- document structure should use proper headings;
- generated tables should remain structurally meaningful.

---

# 101. Internationalization

PhDude must support research written in languages other than English.

Policies should distinguish:

```text
research language
search languages
output language
citation metadata language
```

Core identifiers and schemas remain language-neutral. Prose-quality rules (§29.1) are language-aware: banned-phrase lists, transition inventories and epistemic vocabularies are per-language resources of the `academic-prose` skill, and a language without resources degrades to the language-neutral checks (evidence alignment, structural variation).

---

# 102. Reproducibility

Reproducible research is a first-class engineering requirement.

Whenever possible, maintain:

```text
source
→ transformation
→ result
→ figure/table
→ claim
→ manuscript
```

---

# 103. Build Reproducibility

Given the same canonical state, compatible environment and publication profile, document builds should produce equivalent outputs whenever technically feasible.

---

# 104. Extension Architecture

Extensions fall into explicit categories:

```text
Agent Adapter
Research Provider
Document Adapter
Field Pack
Method Pack
Venue Pack
Reviewer Skill
Analysis Skill
Writing Skill
Exporter
```

Extensions must not mutate arbitrary internal state.

They interact through stable contracts.

Mapping to the four layers (§6, §41a): Packs are PACKS; Skills are SKILLS; Agent Adapters, Research Providers, Document Adapters and Exporters are ADAPTERS; none of them is CORE.

---

# 105. Plugin Discovery

Initially, extensions and skills may be installed through normal npm/Git workflows.

Avoid building a custom plugin marketplace in v1.

A future registry may exist only if ecosystem demand justifies it.

---

# 106. Core Repository Structure

```text
phdude/
│
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── LICENSE
├── package.json
│
├── core/
│   ├── domain/
│   ├── application/
│   ├── ports/
│   └── policies/
│
├── adapters/
│   ├── agents/
│   ├── search/
│   ├── documents/
│   └── execution/
│
├── skills/
│   ├── academic-prose/
│   │   ├── SKILL.md
│   │   ├── references/
│   │   ├── scripts/
│   │   └── tests/
│   └── <other skills>/
├── commands/
├── hooks/
│
├── packs/
│   ├── fields/
│   ├── methods/
│   └── venues/
│
├── schemas/
├── migrations/
│
├── tests/
│   ├── unit/
│   ├── contracts/
│   ├── integration/
│   ├── golden/
│   └── e2e/
│
├── examples/
└── docs/
    └── adr/
```

---

# 107. Research Workspace Structure

```text
my-research/
│
├── AGENTS.md
├── phdude.yaml
│
├── .phdude/
│   ├── constitution.yaml
│   ├── research-policy.yaml
│   ├── writing-policy.yaml
│   ├── citation-policy.yaml
│   ├── methodology-policy.yaml
│   ├── author-profile.yaml
│   └── cache/
│
├── authors/                 # per-researcher voice profiles and approved samples
├── sources/
├── knowledge/
├── research/
├── decisions/
├── data/
├── analysis/
├── figures/
├── tables/
├── manuscript/
├── templates/
└── outputs/
```

---

# 108. Development Stack

PhDude deliberately follows Ponytail's lightweight harness philosophy.

## Core Runtime

```text
Node.js
JavaScript / ESM
npm
```

Prefer JavaScript for the initial implementation.

Use:

- JSDoc;
- JSON Schema;
- runtime validation;

for important contracts.

TypeScript may be considered later only if project complexity demonstrates a clear benefit.

---

## Tests

```text
node:test
```

Avoid adding a larger testing framework without demonstrated need.

---

## Agent Integration

```text
Markdown skills (SKILL.md convention)
AGENTS.md
CLAUDE.md
Lifecycle hooks
Slash commands
Thin adapters
.mjs plugins
```

---

## Canonical Workspace Technologies

```text
Filesystem
Git
Markdown
YAML
JSON / JSONL
BibTeX
CSV
```

---

## Optional Large File Handling

```text
Git LFS
```

---

## Document Tool Adapters

Optional:

```text
Pandoc
LaTeX
DOCX processors
PPTX processors
XLSX processors
```

These remain adapters rather than core runtime requirements.

---

## Scientific Execution

Use the project's environment:

```text
Python
R
Julia
MATLAB
Stata
other research runtimes
```

PhDude must not require them unless a selected workflow requires them.

---

# 109. Agent Portability

```text
             PhDude Core
                  │
        ┌─────────┼─────────┐
        ↓         ↓         ↓
      Claude    Codex    OpenCode
       Code
```

Adapters translate host capabilities into PhDude's ports.

Behavioral research semantics remain shared. Skills are host-neutral Markdown; an adapter only maps them onto the host's skill or command mechanism.

---

# 110. Non-Functional Requirements

## Maintainability

Modules remain small and cohesive.

## Extensibility

New research fields should not require changing core behavior.

## Auditability

Important transformations remain inspectable.

## Determinism

Non-AI transformations should be reproducible.

## Context Efficiency

Load only relevant context.

## Collaboration Safety

Concurrent researchers must not silently overwrite research truth.

## Security

No implicit data exfiltration.

## Portability

No mandatory proprietary format.

## Reliability

Failures should leave recoverable workspace state.

## Cross-Platform

Support major developer operating systems.

## Writing Quality

Generated prose must pass the Writing Pipeline gates; meaning must survive every rewrite.

---

# 111. MVP — v0.1

Develop using a real research project.

Scope:

```text
✓ workspace initialization
✓ PhDude constitution
✓ Claude Code adapter
✓ Codex adapter
✓ Git collaboration
✓ PDF/DOCX/PPTX/XLSX inventory
✓ structured ingestion
✓ project state
✓ field-agnostic core schemas
✓ Field Pack interface
✓ Method Pack interface
✓ paper/source objects
✓ claim/evidence objects
✓ research decisions
✓ knowledge queries
✓ status
✓ next-action recommendation
✓ skills shipped in SKILL.md directory convention
```

Success condition:

> A messy research workspace from any supported discipline can be ingested and PhDude can explain what the project is, what is known, what conflicts exist, and what should happen next without assuming the project's field or methodology.

---

# 112. v0.2 — Research Brain

```text
✓ evidence graph
✓ provenance
✓ research entities
✓ contradiction detection
✓ literature matrix
✓ research gaps
✓ citation registry
✓ schema migration system
✓ skill contract schema (phdude: block) and permission enforcement
```

---

# 113. v0.3 — Research Engine

```text
✓ fresh research
✓ configurable filters
✓ candidate review
✓ freshness tracking
✓ provider adapters
✓ evidence promotion
```

---

# 114. v0.4 — Co-Author

```text
✓ academic tone configuration
✓ author profiles (authors/, primary_voice, project-consensus)
✓ section writing
✓ academic-prose skill (SKILL.md, references, prose-lint.mjs, tests)
✓ /phdude deslop
✓ writing pipeline gates: citation audit, evidence fidelity, author voice, AI-slop audit, meaning preservation
✓ epistemic-precision linkage to evidence strength
✓ proactive recommendations
✓ approval gates
✓ consistency audit
```

---

# 115. v0.5 — Analysis & Visualization

```text
✓ analysis skill system
✓ tables
✓ charts
✓ figures
✓ reproducibility lineage
✓ field/method-specific analysis packs
```

---

# 116. v0.6 — Document Factory

```text
✓ DOCX templates
✓ PDF builds
✓ LaTeX
✓ PPTX templates
✓ XLSX templates
✓ incremental generation
✓ publication profiles as Venue Packs
✓ IEEE
✓ ACM
```

---

# 117. v0.7 — Reviewer

```text
✓ citation auditor
✓ methodology reviewer
✓ Reviewer #2
✓ Research Health (including explainable Academic Prose Quality)
✓ submission readiness
✓ external skill loading with least-privilege defaults
```

---

# 118. v1.0 — Public Release

Requirements:

```text
✓ stable workspace schema
✓ stable extension API
✓ stable skill contract
✓ field-agnostic core
✓ Field Packs
✓ Method Packs
✓ Venue Packs
✓ Claude Code adapter
✓ Codex adapter
✓ at least one additional agent
✓ IEEE profile
✓ ACM profile
✓ generic thesis profile
✓ academic-prose skill with tests
✓ multiple cross-field example projects
✓ migration documentation
✓ extension and skill documentation
✓ CI
✓ contract tests
✓ full test suite
✓ installation workflow
```

---

# 119. Explicit Non-Goals for v1

Do not build:

```text
✗ proprietary cloud
✗ user accounts
✗ billing
✗ mandatory web UI
✗ custom LLM
✗ custom model gateway
✗ custom text editor
✗ mandatory vector database
✗ microservices
✗ Kubernetes
✗ message queues
✗ distributed database
✗ CRDT collaborative editor
✗ heavy autonomous multi-agent orchestration
✗ mobile application
✗ AI-detector integration or detector-score optimization
✗ trained style models or opaque "humanity" scoring
```

A local modular monolith is the default until real constraints prove otherwise.

---

# 120. Success Metrics

## Research Usefulness

Researchers regularly accept PhDude's proactive recommendations.

## Reliability

Fabricated citations approach zero under supported workflows.

## Traceability

Claims can be traced to supporting evidence.

## Context Efficiency

Large unchanged artifacts are not repeatedly loaded.

## Reproducibility

Analytical outputs can be regenerated.

## Portability

The same workspace functions across supported agents.

## Field Generality

PhDude is successfully used across materially different research disciplines without core forks.

## Extensibility

New fields, methods, venues and skills can be added without modifying domain core.

## Collaboration

Multiple researchers can safely contribute while preserving attribution and canonical state.

## Writing Quality

Researchers accept `deslop` revisions with meaning preserved; prose-quality warnings decrease across manuscript revisions; epistemic formulations match evidence strength on audit. (Detector scores are never a metric.)

## Completion

PhDude materially reduces friction between:

```text
research started
        ↓
research completed
        ↓
publication-ready artifact
```

---

# 121. Product North Star

PhDude should always be capable of answering:

## What do we know?

Grounded in current evidence.

## Why do we believe it?

Grounded in provenance.

## What is weak or missing?

Grounded in research quality.

## What changed?

Grounded in research history.

## What should we do next?

Grounded in expected research impact.

---

# 122. Engineering North Star

PhDude's architecture should satisfy:

> **Easy to understand.  
> Hard to misuse.  
> Cheap to extend.  
> Safe to modify.  
> Portable by default.  
> Reproducible where possible.**

A new contributor should be able to understand the core architecture without understanding every integration.

A new research discipline should be addable without forking PhDude.

A new agent should be addable without rewriting research logic.

A new publication format should be addable without rewriting manuscripts.

A new research capability should be addable as a Skill without touching Core.

---

# 123. Definition of PhDude

> **PhDude is a free, open-source, field-agnostic research co-author harness that gives AI coding agents persistent research memory, evidence awareness, methodological judgment, current literature discovery, reproducible analysis, human-quality academic writing, publication formatting, collaborative project state, and proactive research guidance.**

It manages the complete research lifecycle while preserving:

- provenance;
- researcher control;
- methodological pluralism;
- field independence;
- model portability;
- reproducibility;
- collaboration;
- token efficiency;
- authorship voice.

---

# 124. Product Philosophy

**Research first. Text second.**

**Evidence before confidence.**

**Challenge before agreement.**

**Field assumptions belong in packs, not core.**

**Composition over specialization.**

**Reuse before re-reading.**

**Regenerate artifacts, not knowledge.**

**Researchers own the decisions.**

**Git owns the history.**

**Simple architecture until complexity earns its place.**

**Specificity over sophistication.**

**Evidence determines language strength.**

**Human academic voice over generic model prose.**

**Meaning must survive every rewrite.**

**Skills define capabilities. Core defines truth.**

**Never optimize for detector evasion. Optimize for better research writing.**

**PhDude always knows what should happen next.**
