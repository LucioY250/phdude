# Writing a PhDude skill

A skill is what PhDude knows how to do, written for an agent to read. It is Markdown with YAML
front matter — the open Agent Skills convention — plus one PhDude-specific block that says what
the skill is allowed to touch.

Skills are prose, not code. Nothing inside a skill is ever executed by PhDude: it reads the files
and, on install, copies them. A skill that needs to change the workspace runs `phdude add`,
`phdude decide` and the other write commands, so the runtime validates, hashes, attributes and
logs every change ([ADR 4](adr/0004-agent-writes-through-cli.md)).

Write a skill when the capability needs no memory, no provenance and no approval gate. Anything
that must still be true tomorrow, for another researcher on another agent, belongs in core.
[Extending PhDude](extending.md) is the map; this page is how to write the file.

## The directory

```
my-skill/
├── SKILL.md          # required
├── references/       # progressively loaded background the agent reads on demand
├── scripts/          # helper scripts the *agent* may run; PhDude never runs them
└── tests/            # YAML fixture cases, if the skill has checkable behaviour
```

The directory name is the skill name, and the front matter has to agree with it. A mismatch is a
`VALIDATION` error naming both.

## SKILL.md

```yaml
---
name: prisma-screening
description: Screen search results against PRISMA inclusion and exclusion criteria, and record every exclusion with its reason.
phdude:
  version: 1
  reads: [research/searches/**, research/candidates/**, knowledge/sources/**]
  writes: []
  permissions:
    network: none
    workspace: [read]
---

# PRISMA screening

Follow `[[phdude-core]]`. …
```

`name` and `description` are the standard Agent Skills fields. The description is what an agent
reads when deciding whether to open the skill at all, so make it say what the skill *does* and
when to reach for it, in one sentence.

Everything after the front matter is the skill itself. Look at
[`skills/phdude-core/SKILL.md`](../skills/phdude-core/SKILL.md) for the house style: short
sections, the vocabulary the discipline uses, and the exact commands the agent should run.

## The `phdude:` contract

Validated against [`schemas/skill.json`](../schemas/skill.json) (`$id: phdude://skill`). Only the
block is checked, not the rest of the front matter, and `additionalProperties: false` applies to
the block and to `permissions` — an unknown field is a validation error, not a silently ignored
typo.

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `version` | yes | `1` | The only supported contract version. |
| `reads` | yes | `string[]` | Workspace globs the skill reads. |
| `writes` | yes | `string[]` | Workspace globs the skill writes **directly**. Empty for every shipped skill but `academic-prose`. |
| `permissions` | yes | object | See below. |
| `objects` | no | `string[]` | Research object types the skill works with. |
| `artifacts` | no | `string[]` | Artifact kinds it produces. |
| `evidence_requirements` | no | `string` | Free text: what evidence it demands before writing. |
| `provenance` | no | `string` | Free text: how it records provenance. |
| `approval_gates` | no | `string[]` | Approval gates its output must pass. |
| `quality_gates` | no | `string[]` | Quality gates its output must pass. |
| `dependencies` | no | `string[]` | Other skills this one depends on. |
| `tests` | no | `string` | Path to the skill's own fixture tests. |

`permissions` is `{ network, execution?, workspace }`:

| Field | Values | Default |
| --- | --- | --- |
| `network` | `none` \| `allowed` | required, no default |
| `execution` | `none` \| `allowed` | `none` — optional since 0.5, so a skill written earlier stays valid |
| `workspace` | one or more of `read`, `write:manuscript`, `write:knowledge`, `write:sources` | required, at least one |

**`writes` is almost always empty.** A skill that says it writes `knowledge/**` is claiming it
edits YAML behind the runtime's back, and that is exactly what the CLI exists to prevent. The one
exception in this repository is `academic-prose`, which declares `manuscript/**` (PRD §30b) — and
even there the prose reaches the workspace through `phdude manuscript submit`, never through a
file edit.

**Least privilege is the default.** A skill with no `phdude:` block still loads, because the open
convention does not require one, but it gets
`{ version: 1, reads: [], writes: [], permissions: { network: 'none', workspace: ['read'] } }` and
the warning `skill <name>: no phdude contract, least privilege assumed`. A block that is present
but invalid does not load at all. Declare the block: a skill that loads with a warning is a skill
the researcher has to think about.

**Asking for more costs something.** `.phdude/research-policy.yaml` carries
`skills.allow_network` and `skills.allow_execution`, both `false` by default, and both gate
*installation*:

| Where | A skill asking for network or execution the policy has not opened |
| --- | --- |
| `phdude packs apply` | The whole pack is refused with `POLICY`. Adopting half a pack is not what anyone asked for. |
| `phdude init` | The skill is **withheld**, every other one installs, exit 0. A default workspace must still initialize, and the output names the skill and the setting that would install it. |
| `phdude skills install` | Refused with `POLICY`, naming the setting. Better than installing it and then withholding it. |

The two settings are independent — opening the network does not open execution — and neither
decides whether a script actually runs. That is `execution.enabled` in the same file, checked at
run time by `phdude analyze run` and `phdude figure build`, so a workspace can hold both skills
and still refuse every run.

## Fixture tests

A skill with checkable behaviour ships YAML cases under `tests/`, so a researcher can add one
without writing JavaScript. The shipped shape, from
[`skills/academic-prose/tests/`](../skills/academic-prose/tests/):

```yaml
lang: en
cases:
  - name: vague-literature-without-a-citation
    expect: [vague-literature]
    text: |
      Recent studies report the same gap in the undergraduate population.

  - name: the-same-claim-with-its-sources-named
    expect: []
    text: |
      Recent studies report the same gap [@lopez2023; @bell2021].

  - name: a-case-that-must-not-fire-one-rule
    absent: [banned-phrase]
    text: |
      The response rate was 68 percent.
```

A case carries either `expect` — the exact set of rules that must fire, `[]` for text that must
pass clean — or `absent`, the rules that must not fire. Both are checked against real behaviour,
not against a description of it.

The runner is in-tree and specific to the rules it exercises:
[`tests/contracts/academic-prose.test.js`](../tests/contracts/academic-prose.test.js) parses the
YAML and runs each case through the same `lint` the CLI and the prose gate use, and it also
asserts that every rule the linter has is exercised by at least one fixture. There is no generic
fixture runner for a third-party skill yet — point the `tests` field at your cases and ship a
runner of your own, or read the shipped one as the pattern.

## Installing it

```
phdude skills install ../lab-skills/prisma-screening
phdude skills install https://example.org/lab/prisma-screening.git --allow-network
phdude skills list
phdude skills remove prisma-screening
```

The tree is staged and validated **outside** the workspace before anything lands in
`.phdude/skills/`, so a refusal leaves nothing behind. Five rules decide whether a skill is
installed at all:

- **The contract** validates against the schema above, or the install fails with `VALIDATION`
  naming the fields.
- **The purpose.** A skill whose `name` or `description` matches
  `/detect(or|ion)\s+(evasion|bypass)|humaniz|humanity score/i` exits 3 with `POLICY`. PhDude has
  no detector score and will not install a skill that offers one (PRD §30c). The regex reads the
  purpose the skill declares about itself, not the whole file, so a skill that *states the
  prohibition* stays installable.
- **The permissions**, as above.
- **The name.** A name PhDude ships is refused, because `phdude init` mirrors the shipped set into
  `.phdude/skills/` and would overwrite the copy. A name already installed is refused unless
  `--force` replaces it.
- **No symlinks.** A symlink anywhere in the source directory is refused: following it would copy
  bytes from outside the directory you named.

A git source is cloned with `execFile('git', [...])` — an argument array, never a shell — as a
shallow clone of one commit, over `https` without credentials; every other transport is refused
before git is called, and the clone's `.git` is not copied.

Each install writes `{ name, source, hash, installed_at }` into `.phdude/skills-lock.yaml` and one
`skills` event. The hash is one sha256 over the tree's sorted `<path> <sha256>` lines, so an
edited byte and a renamed file both move it and `phdude doctor` reports a skill that changed after
it was reviewed. See [the skills lock](workspace.md#the-skills-lock).

## Discovery and precedence

`discoverSkills` walks its roots in order — the package's own `skills/`, each applied pack's skill
directories, then `<workspace>/.phdude/skills/` — and a later root's skill overrides an earlier one
with the same name. One unloadable skill aborts the whole discovery, which is what `init` and
`packs apply` need: neither may adopt half a set. `phdude doctor` opts out of that with an
`onError` callback, so a broken skill costs one warning rather than the whole report.

Installing or removing a skill rewrites the skill index in `AGENTS.md` and `CLAUDE.md`, so an
external skill reaches the agent through the same file the shipped ones do.

`phdude doctor` lists the resulting set with each skill's source — `core`, `pack:<name>` or
`workspace` — and its declared permissions. A skill installed from outside is additionally marked
external, with the path or URL it came from and `(edited)` when its files no longer hash to what
was recorded. Because `init` copies the core skills
into `.phdude/skills/`, `source` compares the copy against the shipped bytes: identical is still
`core`, and only an edited copy is `workspace`.

## Bundling a skill in a pack

A field or method pack lists its skills in `pack.yaml`, and `phdude packs apply` installs them
with the pack. That is the right home for a skill that only makes sense inside one discipline. See
[docs/packs-authoring.md](packs-authoring.md), and
[`examples/extensions/pack-example/`](../examples/extensions/pack-example/) for a worked one.

## Checklist

- [ ] The directory name, the front-matter `name`, and the pack entry (if any) all agree.
- [ ] `description` says what the skill does and when to reach for it, in one sentence.
- [ ] The `phdude:` block is present and validates; `writes` is empty unless you can say why not.
- [ ] `permissions` asks for the least the skill can work with.
- [ ] Fixture cases under `tests/` for anything checkable.
- [ ] `phdude skills install <dir>` succeeds in a scratch workspace, and `phdude doctor` shows it.
