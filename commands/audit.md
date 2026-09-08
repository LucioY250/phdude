---
description: Audit the citations against the registry, the manuscript and (when the policy allows) Crossref.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude audit citations $ARGUMENTS --json
```

This writes: every finding becomes a `citation` REVIEW object the researcher can accept,
dismiss or resolve. A finding already on file is left exactly as it is — re-running the audit
never reopens something the researcher already ruled on — so running it twice is safe and the
second run records no event.

Offline it checks four things: every `[@key]` in every drafted section resolves to a recorded
source (`block`), every claim the prose asserts rests on evidence that cites a source
(`major`), no cited source is still an unreviewed candidate (`minor`) or one the researcher
dismissed (`major`), and every `phdude cite check` finding at its own weight.

`--allow-network` adds the DOI verification: each source's DOI is resolved at Crossref, and a
title that does not match (`major`), a year more than one out (`minor`) or a recorded
retraction (`block`) becomes a finding. **Never pass `--allow-network` yourself** — nothing
leaves the machine unless the researcher asked or the policy already says so
(`[[phdude-core]]`). A lookup that fails is reported as a warning, not as a missing DOI.

The command exits 0 even when it records a `block`: it reports. `phdude ready` is where a block
stops a submission.

Report the new findings worst first, quoting the message and the ids each rests on, and name
the command that would fix the top one. Do not accept, dismiss or resolve a finding — that is
the researcher's call.
