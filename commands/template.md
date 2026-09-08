---
description: Register the document templates a build renders through, bind one to a profile, and check a DOCX has the styles Pandoc needs.
allowed-tools: Bash(phdude:*), Bash(npx:*)
phdude-managed: true
---

Arguments: `$ARGUMENTS`

Run:

```
phdude template $ARGUMENTS --json
```

(`list`, `add <path> [--kind docx|pptx|latex]`, `use <name> --for <profile>`, `check <name>`.)

`add` copies a template already inside the workspace into `templates/<kind>/` and records its
name, kind, path and hash. The name is the slug of the file it came from, and it is the identity:
adding a changed file under the same name corrects the entry and keeps the profile it was bound
to. A template outside the workspace is refused — put it under `templates/` first.

`use <name> --for <profile>` is what makes a build or a presentation pick that template up. With
nothing bound, a single registered template of the right kind is used and two are not: PhDude will
not choose between them.

`check <name>` unzips a DOCX and reports the styles Pandoc writes with — Heading 1–3, Body Text,
Caption — that the template does not declare, and whether the file still hashes to what was
registered. It exits 2 when the template is not ready to render with. Run it before a build, not
after: a missing style is silently lost formatting, not an error the renderer reports.
