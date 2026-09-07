# Golden tests

Each test here runs a real use case (`status`, `next`, `gaps`, `matrix`, `cite export`) against
the committed `examples/generic-thesis` workspace and compares the renderer's plain-text output
to the matching file in `expected/` byte-for-byte.

The example is generated to reach every `gaps` kind, so `gaps.txt` doubles as the worked example
of each one; `gaps.test.js` asserts the full set, and adding a kind without giving the example
something that triggers it fails there.

`examples/generic-thesis` is itself generated (not hand-authored) by `scripts/make-example.mjs`;
see that file and `tests/integration/make-example.test.js` for how it stays reproducible.

## Regenerating the goldens

After a deliberate change to a renderer, a use case, `recommendNext`, `findGaps`, or the example
workspace itself, regenerate the example and then rewrite the golden files:

```
npm run example
UPDATE_GOLDEN=1 node --test "tests/golden/*.test.js"
```

Then diff `tests/golden/expected/` to confirm the change is the one you intended before
committing.
