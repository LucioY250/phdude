# PhDude
<img width="254" height="254" alt="logoPHDude" src="https://github.com/user-attachments/assets/1716fadd-7327-4a99-907e-a59855b557cc" />




**The senior researcher in your terminal.**

Your AI can write. PhDude helps make the research worth publishing.

PhDude is a free, open-source, field-agnostic research co-author harness for AI coding
agents. It turns a general-purpose agent such as Claude Code or Codex into a persistent,
evidence-aware research collaborator that owns the whole project rather than one-off
answers: what you are trying to establish, what evidence exists, what is missing, what
contradicts what, and what to do next.

Nothing about your discipline is baked in. A medical trial, an ethnography and an empirical
software-engineering paper all work the same way; the field-specific vocabulary arrives
through packs.

> **Status:** v0.1. The deterministic harness, the workspace, the knowledge graph, conflict
> detection, status and next-action recommendations are done. Literature search, analysis
> execution and the writing engine are on the roadmap below.

## What it is

- **A persistent research state** in your own git repository: artifacts, sources, claims,
  evidence, facts, research questions, hypotheses and decisions, one YAML file each.
- **A deterministic runtime** that owns inventory, hashing, text extraction, validation,
  lineage, contradiction detection and next-action scoring. No model is involved in any of it.
- **Agent skills** that give the model the working discipline of a senior researcher, and a
  CLI it must write through so every change is validated, attributed and logged.

## What it is not

Not a chatbot, a citation generator, a PDF-chat app, a literature-search website, a thesis
generator, a research SaaS, or another AI text editor. It does not write your thesis for
you and it will not pretend a claim is established when the evidence says otherwise.

## Install

v0.1 is not yet published to npm. Install it from the repository:

```
git clone https://github.com/LucioY250/phdude && cd phdude
npm ci
npm link
phdude --version
```

`npm install` support comes with the 0.1.x release.

Node 22 or newer. `pdftotext` (poppler-utils) is optional; without it PDFs are still
inventoried and hashed, and `phdude doctor` tells you what is missing.

## Quick start

```
mkdir my-research && cd my-research
phdude init --title "Adaptive scheduling in edge clusters"
cp ~/Downloads/*.pdf ~/Downloads/*.docx sources/
```

**With Claude Code**, open the directory and run the slash command:

```
/phdude bootstrap
```

**With Codex** (or any other agent), run the command yourself and let the agent take it from
there; `AGENTS.md` already tells it what to do:

```
phdude bootstrap
```

Either way PhDude ingests `sources/`, extracts and caches the text, reports what it found,
and hands off to the agent to classify the artifacts and extract the first sources, facts
and candidate claims. Then ask it anything:

```
phdude status     # what the project is, what is known, what conflicts
phdude next       # the highest-impact next action, and why
```

`phdude next` always explains itself:

```
Highest-impact next action:

Resolve the conflicting value(s) for "sample_size"

Why:
- sample_size: 312 participants (ART-35146e2f6d, ART-0772a215de) vs 300 participants (ART-f7ced78004)
- 1 claim(s) depend on the conflicting artifacts

Expected impact:
HIGH

Command:
phdude decide propose --title "Resolve sample_size" --rationale "…" --affects FACT-2bc4462edb FACT-54af7fa906 FACT-f62e1a2f34 --change '{"fact_key":"sample_size","canonical_value":…}'

Other candidates:
1. (medium) Classify artifacts with unknown role
2. (medium) Approve or reject pending decisions
3. (low) No further automatic recommendations; add new sources or refine claims
```

That block is `node bin/phdude.js next --workspace examples/generic-thesis`, verbatim.

## Commands

| Command | What it does |
|---|---|
| `phdude init [dir]` | Create a workspace. Idempotent. |
| `phdude bootstrap` | Ingest, detect packs, report status and next, hand off to the agent. |
| `phdude ingest [paths…]` | Inventory, hash, extract and cache source documents. |
| `phdude status` | Project, inventory, knowledge counts, conflicts, pending decisions. |
| `phdude next` | The highest-impact next action, with reasons and the exact command. |
| `phdude knowledge list\|show\|trace` | Query the knowledge graph and its lineage. |
| `phdude add <type>` | Add a claim, evidence, fact, source, question, hypothesis or result, or set an artifact's role with `add artifact-role`. |
| `phdude decide propose\|approve\|reject\|supersede` | Research decisions; the researcher decides. |
| `phdude promote <id> --decision <DEC-id>` | Move an object to canonical. |
| `phdude packs list\|detect\|apply <name>` | Field and method packs. |
| `phdude mode lite\|full\|ruthless\|off` | Set the review mode. |
| `phdude doctor` | Adapters, cache, schema versions, git state. |

Every command takes `--json`. Exit codes: 0 ok, 1 usage, 2 validation, 3 policy, 4 external
tool missing. Full reference: [docs/cli.md](docs/cli.md).

## The workspace

```
my-research/
├── phdude.yaml          # project config: title, fields, methods, outputs, mode
├── AGENTS.md            # shared agent instructions
├── CLAUDE.md            # Claude Code entry point
├── .phdude/             # policies, installed skills, events.jsonl, cache/
├── sources/             # the raw materials you drop in
├── knowledge/           # artifacts, sources, claims, evidence, facts, results
├── research/            # questions, hypotheses
├── decisions/           # DEC-*.yaml
└── data/ analysis/ figures/ tables/ manuscript/ outputs/
```

Plain YAML and Markdown in a git repository. You can read, diff and merge all of it without
PhDude installed. Full detail: [docs/workspace.md](docs/workspace.md).

## Principles

- **Research quality over text generation.** The goal is publishable research, not fluent prose.
- **Evidence before claims.** Nothing is stated more confidently than its knowledge state
  allows. `candidate` gets hedged; only `canonical` gets stated plainly.
- **Human authority.** Research questions, methodology, accepted results and canonical
  claims belong to the researcher. The agent proposes; approval is a human act, enforced by
  the CLI.
- **Field agnosticism.** No discipline is assumed. Domain knowledge arrives as packs.
- **Local-first, data yours.** Your research lives in your repository, in a format that
  outlives this tool.
- **Token-efficient by architecture.** Agents read cached sections, not whole documents.
- **Skill-first, not skill-only:**

  ```
  CORE     = what PhDude knows and remembers.
  SKILLS   = what PhDude knows how to do.
  PACKS    = how PhDude adapts to a field, method or venue.
  ADAPTERS = how PhDude interacts with an agent or external system.
  ```

  A capability that needs no memory, no provenance and no approval gate is a Skill. Anything
  that must be true tomorrow for another researcher on another agent belongs in Core.

The reasoning behind the big calls lives in [docs/adr/](docs/adr/).

## Roadmap

| Version | Theme | Highlights |
|---|---|---|
| **v0.1** | MVP | workspace, ingestion, knowledge graph, decisions, conflicts, status, next, packs, Claude Code and Codex adapters |
| v0.2 | Research Brain | evidence graph, literature matrix, research gaps, citation registry, schema migrations, skill permission enforcement |
| v0.3 | Research Engine | fresh literature search, provider adapters, candidate review, freshness tracking |
| v0.4 | Co-Author | author voice profiles, section writing, academic-prose skill, `/phdude deslop`, writing gates |
| v0.5 | Analysis & Visualization | analysis skills, tables, charts, figures, reproducibility lineage |
| v0.6 | Document Factory | DOCX, PDF, LaTeX, PPTX and XLSX output, venue packs (IEEE, ACM) |
| v0.7 | Reviewer | citation auditor, methodology reviewer, Reviewer #2, Research Health, submission readiness |
| v1.0 | Public Release | stable workspace schema, extension API and skill contract, a third agent, cross-field examples, migration docs |

## Contributing

Install from source as above, then:

```
npm test
```

Tests use `node:test` only. Before opening a pull request:

```
npm run format && npm run lint && npm test
```

New parsers, agent hosts and packs plug in behind documented ports with contract suites you
can run against your implementation. Start at [docs/extending.md](docs/extending.md).

## License

MIT. See [LICENSE](LICENSE).
