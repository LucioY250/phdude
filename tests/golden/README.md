# Golden tests

Each test here runs a real use case (`status`, `next`, `gaps`, `matrix`, `freshness`,
`cite export`) against the committed `examples/generic-thesis` workspace and compares the
renderer's plain-text output to the matching file in `expected/` byte-for-byte. The reports
that read a calendar are given a fixed present, so an age measured in days or years renders the
same today and in a year.

The example is generated to reach every `gaps` kind, so `gaps.txt` doubles as the worked example
of each one; `gaps.test.js` asserts the full set, and adding a kind without giving the example
something that triggers it fails there.

`table.test.js` and `bar-chart.test.js` are the exceptions: the table renderers and the shipped
figure generator are pure functions of their input, so they run on fixtures rather than on the
example, and pin the exact bytes of a Markdown, a LaTeX and a CSV table and of the generated SVG.
They take `UPDATE_GOLDEN=1` the same way.

`build.test.js` runs `phdude build` against a throwaway copy of the example, the way
`cite.test.js` does, because `outputs/` is derived and is not committed with it. Two files are
pinned: `build-manuscript.md`, the whole `--format md` deliverable, and `build-ieee-source.md`,
the Markdown a `--format latex --profile ieee` build hands to Pandoc. The `.tex` Pandoc then
writes is asserted structurally rather than byte for byte — Pandoc's LaTeX output moves between
Pandoc versions, and CI's Pandoc is not the one on a developer's machine, so a byte-exact `.tex`
golden would fail on a version bump that changed nothing about PhDude. The IEEE test skips
honestly where Pandoc is absent.

`examples/generic-thesis` is itself generated (not hand-authored) by `scripts/make-example.mjs`;
see that file and `tests/integration/make-example.test.js` for how it stays reproducible.

`examples.test.js` is the same idea over the three cross-field workspaces
(`quantitative-social-science`, `machine-learning`, `qualitative-humanities`): five reports each,
pinned under `expected/<example>/`, rendered against the same fixed present. It is parametrised
over the profiles `scripts/make-examples.mjs` exports, so an example added there gets its goldens
by running the update command below. See `docs/examples.md`.

The example's `analysis/out/`, `tables/out/` and `figures/out/` files are **committed**, even
though a real workspace's `.gitignore` excludes them. They were added with `git add -f` on
purpose: the example is a finished workspace a reader clones and looks at, `repro.test.js` asserts
that nothing in it is stale, and `make-example.test.js` compares the whole generated tree against
the committed one. A run whose output was not committed would show up in both as missing. Nothing
special is needed to keep them current — once tracked, git follows them — but a new output path
added to the example has to be `git add -f`ed the first time.

## Regenerating the goldens

After a deliberate change to a renderer, a use case, `recommendNext`, `findGaps`, or the example
workspace itself, regenerate the example and then rewrite the golden files:

```
npm run example
UPDATE_GOLDEN=1 node --test "tests/golden/*.test.js"
```

Then diff `tests/golden/expected/` to confirm the change is the one you intended before
committing.
