# What this changes

<!-- One paragraph. What was wrong or missing, and what the change does about it. -->

Closes #

## How it was verified

<!--
The commands you ran and what they said. `npm test` counts before and after is the most useful
line you can write here. If a golden or an example workspace changed, explain every changed line.
-->

```
npm run format && npm run lint && npm test
```

## Checklist

- [ ] Tests were written first, and they fail without the change.
- [ ] `npm run format`, `npm run lint` and `npm test` are clean.
- [ ] Docs updated: `docs/cli.md`, the README command table, the slash-command template and
      `COMMAND_OPTIONS` if this adds or changes a command.
- [ ] A `CHANGELOG.md` entry under `## [Unreleased]`, in the right category.
- [ ] No new runtime dependency, or the pull request argues for the one it adds.
- [ ] No schema change; or `x-phdude.since` is bumped, a migration is written, and the snapshot is
      re-recorded (see [docs/versioning.md](https://github.com/LucioY250/phdude/blob/main/docs/versioning.md)).
- [ ] Nothing here scores text for how human it looks or helps evade a detector
      ([docs/non-goals.md](https://github.com/LucioY250/phdude/blob/main/docs/non-goals.md)).
- [ ] `examples/` and `tests/golden/` regenerate clean, or every changed line is explained above.
