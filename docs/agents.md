# Agent hosts

PhDude is a CLI and a workspace on disk. The agent is whatever you already use. `phdude init`
writes the entry files that host expects, and nothing else about the project changes: the
knowledge graph, the decisions and the audit log are identical whichever agent wrote them, so
two people on two different agents can share one repository and one git history.

```
phdude init --title "Adaptive scheduling in edge clusters" --agents claude-code,codex,opencode
```

`--agents` takes a comma-separated list. The default is `claude-code,codex`. Naming a host
PhDude does not know exits 1 and lists the ones it does.

| Host | What it reads | What `init` writes |
|---|---|---|
| `claude-code` | `CLAUDE.md`, then `AGENTS.md` | `CLAUDE.md`, `AGENTS.md` (skills index), `.claude/commands/phdude*.md` |
| `codex` | `AGENTS.md` | `AGENTS.md` (every skill inlined) |
| `opencode` | `AGENTS.md`, and a command file when you type it | `AGENTS.md` (skills index), `.opencode/command/phdude*.md` |
| Gemini CLI and others | `AGENTS.md` | nothing host-specific — use `codex` or `opencode` for the file it reads |

Every file PhDude writes carries a managed marker: the plain `<!-- phdude:managed -->` line at
the top of `AGENTS.md` and `CLAUDE.md`, or `phdude-managed: true` in a command file's front
matter. Delete the marker and the file is yours — the next `init` reports it as skipped instead
of rewriting it.

## The two shapes of AGENTS.md

`AGENTS.md` holds the operating rules, the command reference, and the skills. The skills part
comes in two shapes, and which one you get depends on the hosts you asked for.

- **The index.** One line per skill: its name, its description, and the path to its `SKILL.md`
  under `.phdude/skills/`. The agent loads a skill only when its command or task is actually
  active. Claude Code and OpenCode get this, because both can open a file mid-session.
- **The inlined form.** Every skill's full body, under a `## Skill: <name>` heading. Codex reads
  `AGENTS.md` once at the start of a session and cannot go and fetch a skill later, so it needs
  everything up front.

When you ask for both kinds of host, the index wins. It is the smaller file, and Codex still
finds every skill by the path the index gives it — it just has to open it. Whichever host runs
second sees the index already on disk and leaves it alone.

## Claude Code

```
mkdir my-research && cd my-research
phdude init --title "Adaptive scheduling in edge clusters" --agents claude-code
```

`CLAUDE.md` imports `AGENTS.md` with `@AGENTS.md` and adds the Claude-specific notes: the list
of slash commands, and the instruction to load a skill only when it is needed.

`.claude/commands/` gets one file per CLI command. `/phdude` is the dispatcher — on its own it
reports status and the top next action, `/phdude ruthless` (or `lite`, `full`, `off`) sets how
hard the agent pushes back, and anything else is passed through as a subcommand. Every other
template installs as `/phdude-<command>`: `/phdude-bootstrap`, `/phdude-status`, `/phdude-next`,
and so on through the whole command table. Each one runs the CLI with `--json` and follows the
matching skill, and each is allow-listed to `Bash(phdude:*)` and `Bash(npx:*)` — a slash command
cannot run anything else.

Open Claude Code in the directory and start with `/phdude bootstrap`.

## Codex

```
mkdir my-research && cd my-research
phdude init --title "Adaptive scheduling in edge clusters" --agents codex
```

One file: `AGENTS.md`, with every skill inlined. Codex has no slash-command mechanism, so there
is nothing else to install.

Open Codex in the directory and ask it to bootstrap the research workspace. It will run
`phdude bootstrap --json`, follow the bootstrap skill, and report what the project is, what is
known, what conflicts, and what to do next. From then on ask it for status, the next action, or
any `phdude` command by name.

## OpenCode

```
mkdir my-research && cd my-research
phdude init --title "Adaptive scheduling in edge clusters" --agents opencode
```

OpenCode reads `AGENTS.md` and takes custom commands from `.opencode/command/`, so it gets the
skills index plus the same command set Claude Code gets, under the same names: `/phdude` for the
dispatcher and `/phdude-<command>` for the rest. The bodies are the same templates — the
`$ARGUMENTS` placeholder OpenCode expands is the one Claude Code expands too — with the
`allowed-tools` line dropped, because that permission key is Claude Code's and OpenCode does not
read it.

That last point is the one difference worth knowing. Under Claude Code a PhDude slash command
can only run `phdude`; under OpenCode it runs with whatever permissions you have given the
session. If you want the same boundary, set it in your OpenCode permission config.

Open OpenCode in the directory and start with `/phdude bootstrap`.

## Gemini CLI, and anything else

Gemini CLI reads `AGENTS.md` from the working directory, so it needs no host of its own:

```
phdude init --title "…" --agents codex
```

gives it the file it reads, with every skill inlined. If your agent can open a file on demand,
`--agents opencode` gives it the smaller index instead and the command templates are there to
copy into whatever format it wants. Either way the research state is the same.

An agent that reads nothing by default still works. Point it at
`.phdude/skills/phdude-core/SKILL.md` — that is the operating contract: the CLI is the only way
to write, the researcher approves, and the agent proposes.

**What is verified, and what is not.** All three hosts are covered by the shared contract suite
in `tests/contracts/agent-host.test.js` (`agentHostContract` plus per-host cases) and by
`tests/integration/init.test.js`. Those tests assert the files each host writes, the front matter
in them, that a second `init` rewrites nothing, and that a file whose marker you removed is left
alone. That is what `npm test` checks, and it is a file-level check.

What no test does is open an agent and run a command. Driving three vendor CLIs needs three
accounts and a network, so the OpenCode and Gemini CLI paths here were confirmed by reading each
tool's documented conventions — `AGENTS.md` in the working directory, `.opencode/command/<name>.md`
with a `description` front-matter key and `$ARGUMENTS` in the body — and then checking that
`init` produces exactly that. If your agent disagrees with this page, the page is what is wrong;
please report it.
