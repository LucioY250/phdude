# pack-example

A third-party field [pack](../../../docs/packs-authoring.md) with one
[skill](../../../docs/skills-authoring.md). Unlike the other three examples this one is data, not
code — which is why it is the only one a workspace can install without touching PhDude itself.

```
pack-example/packs/
└── fields/
    └── example-field/
        ├── pack.yaml
        └── skills/
            └── example-field/
                └── SKILL.md
```

## Installing it

Copy the pack directory into a workspace and apply it:

```
cp -R packs/fields/example-field /path/to/workspace/.phdude/packs/fields/
cd /path/to/workspace
phdude packs list
phdude packs apply example-field
```

`.phdude/packs/` is searched after the packs PhDude ships, so a workspace pack with the name of a
built-in one overrides it. `apply` records the pack in `phdude.yaml` and writes one event; it
refuses the whole pack if any of its skills asks for a permission the research policy has not
opened.

## What it demonstrates

- **The pack shape.** `schema`, `version`, `name`, `kind`, `description`, `terminology`,
  `detect.keywords`, `reviewers`, `recommended_checks`, `skills`, `schemas` — every key required,
  unknown keys refused.
- **Detection that recommends but never applies itself.** `phdude packs detect` scores the
  keywords against the cached text of the corpus and records a recommendation; adopting a pack
  stays a decision the researcher makes.
- **A skill with a `phdude:` contract.** Least privilege: it reads the knowledge graph, writes
  nothing, and asks for no network. A skill that writes goes through the CLI, so the runtime
  validates, hashes, attributes and logs the change.
- **Skill paths that stay inside the pack.** The loader refuses an absolute path, a `..`, a NUL
  byte, and a symlink pointing out of the pack directory.
- **Guidance, not code.** A pack carries vocabulary and recommendations. Nothing in it is ever
  executed.

The field is science and technology studies, a discipline PhDude does not ship a pack for, so the
vocabulary and review questions are real rather than filler.

## Running its contract checks

```
node --test tests/contracts/example-extensions.test.js
```

MIT licensed.
