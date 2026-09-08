# Non-goals

Things PhDude will not become. This page exists so a contributor can find out in one minute
whether an idea is worth writing up, and so a maintainer can say no once rather than in every
issue.

It mirrors [PRD §119](PRD.md). A non-goal is not a backlog item, and "no" here is a design
position, not a shortage of time.

## The list

| Not building                                   | Why                                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A proprietary cloud                            | Your research lives in your repository. There is no server to be down, to be acquired, or to read your unpublished work. |
| User accounts                                  | The identity in the record is a name you chose, `--by`. Nothing to sign up for, nothing to sign in to.             |
| Billing                                        | MIT, and it stays that way.                                                                                        |
| A mandatory web UI                             | The CLI and your agent are the interface. A viewer someone builds on top is fine; needing one is not.              |
| A custom LLM                                   | PhDude has no model. It is the harness around whichever agent you already use.                                     |
| A custom model gateway                         | Your agent talks to its provider. PhDude never sees a token, a prompt or a completion.                             |
| A custom text editor                           | Prose is Markdown on disk. Write it in whatever you already write in.                                              |
| A mandatory vector database                    | Retrieval is deterministic: ids, citations, links and a cache you can read. An embedding index would be a second, fuzzier source of truth. |
| Microservices, Kubernetes, message queues, a distributed database | It is a CLI that reads and writes files in a git repository. A local modular monolith is the default until a real constraint proves otherwise. |
| A CRDT collaborative editor                    | git already merges text, and a research decision should be a conflict a human resolves, not one a data structure resolves silently. |
| Heavy autonomous multi-agent orchestration     | The researcher approves. Adding agents that approve each other removes the only step that matters.                 |
| A mobile application                           | Nothing here is a phone-sized task.                                                                                |
| AI-detector integration or detector-score optimization | See below.                                                                                                  |
| Trained style models or opaque "humanity" scoring | See below.                                                                                                      |

## The detector rule, in full

There is no detector score in PhDude and there will not be one. It will not tell you how human
your text looks, and it will not help you make it look more human. This is the one non-goal
enforced in code rather than by convention:

- **No command** accepts a flag naming a detector, a humanizer or a humanity score. The refusal
  is in the argument parser, before any command-specific parsing, so it cannot be reached by
  finding the command that forgot to say no. It exits 3 (POLICY).
- `phdude prose` reports six located sub-scores of academic prose quality — hedging, nominalization,
  citation density and so on, each with the sentences behind it. It is a writing report, not a
  classifier, and it says so on its own output.
- `phdude skills install` refuses a skill whose stated name or description is detector evasion or
  humanizing, before a byte lands in the workspace.

Two reasons, and the second is the real one. Detectors do not work: they are unreliable, they are
biased against people writing in a second language, and their scores move for reasons unrelated to
who wrote the text. And optimizing for one is optimizing for the wrong thing. PhDude's whole
argument is that the fix for text that reads as machine-generated is research that is actually
grounded — a claim tied to evidence, a number tied to an analysis, a citation that resolves. A
score that could be improved without improving any of that would quietly replace the goal.

The reasoning is in [ADR 8](adr/0008-writing-pipeline-and-no-detector-rule.md).

## What this does not rule out

Plenty. The boundary is "does the core have to change", and most of the answers are no:

- **Your field, your method, your venue.** Packs carry vocabulary, reviewer perspectives, checks
  and publication profiles. See [packs-authoring.md](packs-authoring.md).
- **New capabilities for the agent.** Skills are Markdown with a declared contract and declared
  permissions. See [skills-authoring.md](skills-authoring.md).
- **New formats and new sources.** Parsers, renderers, search providers, agent hosts and analysis
  runners all sit behind ports with contract suites. See [extension-api.md](extension-api.md).
- **Reading your workspace with something else.** It is YAML and Markdown in a git repository,
  documented in [workspace.md](workspace.md). Build the dashboard, the viewer or the exporter you
  want; nothing here is a lock-in.

## Extending is not the same as loading

One boundary that catches people out: PhDude executes no JavaScript from outside the package.
There is no plugin loader and no `~/.phdude/plugins`. Packs and skills are data a workspace can
install on its own; a parser, renderer, provider, host or runner is registered in-tree and arrives
by pull request, with its contract suite.

That is deliberate. A research record whose provenance depends on code nobody reviewed is a
record you cannot defend, and a tool that runs arbitrary code from a URL is a tool that will
eventually run the wrong one. [extension-api.md](extension-api.md) says which ports are which.
