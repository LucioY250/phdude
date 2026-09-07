# Golden tests

`status.test.js` and `next.test.js` run the real `status`/`next` use cases against the committed
`examples/generic-thesis` workspace and compare `renderStatus`/`renderNext`'s plain-text output to
the files in `expected/` byte-for-byte.

`examples/generic-thesis` is itself generated (not hand-authored) by `scripts/make-example.mjs`;
see that file and `tests/integration/make-example.test.js` for how it stays reproducible.

## Regenerating the goldens

After a deliberate change to `renderStatus`, `renderNext`, `status()`, `next()`,
`recommendNext`, or the example workspace itself, rewrite the golden files with:

```
UPDATE_GOLDEN=1 node --test tests/golden/*.test.js
```

Then diff `tests/golden/expected/status.txt` and `tests/golden/expected/next.txt` to confirm the
change is the one you intended before committing.
