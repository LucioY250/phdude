---
description: Assemble a bounded review context, submit what a reviewer found as REVIEW objects, and read or decide on the findings.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude review $ARGUMENTS --json
```

`phdude review <kind>` — `methodology`, `reviewer2`, `reproducibility`, `citation` or `custom` —
assembles the review context into `.phdude/cache/review/<kind>/context.md` and prints the
findings contract. It records nothing. Add `--target <id|manuscript:<section>|project>` to review
one object or one section instead of the whole project, and `--budget <chars>` to change how much
context is assembled.

Read the context file, follow the matching skill (`[[methodologist]]`, `[[reviewer2]]`,
`[[reproducibility-reviewer]]`), and write the findings as JSON:

```json
{
  "findings": [
    {
      "target": "CLAIM-…",
      "severity": "major",
      "message": "…",
      "evidence": ["EVID-…"],
      "suggested_command": "phdude edit CLAIM-… --json '{\"statement\":\"…\"}'"
    }
  ]
}
```

Then:

```
phdude review submit --file findings.json --kind methodology
```

Every `target` and every `evidence` id must already exist, or the whole file is refused with one
line per problem. A finding already recorded — the same kind, target and message — is left
exactly as it is, so re-running a review never reopens something the researcher dismissed.

`phdude review list [--status open|accepted|dismissed|resolved] [--kind k]` and `phdude review
show <REVIEW-id>` read the findings. `accept`, `dismiss` and `resolve` are the researcher's
verdicts, never yours: an open finding becomes `accepted` or `dismissed`, and only an accepted
one becomes `resolved`. Report what is open and let the researcher decide.
