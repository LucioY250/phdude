# 0010 — Renderer adapters and reproducible builds

**Status:** accepted
**Date:** 2026-09-07

## Context

A manuscript that only exists as approved sections in a workspace is not a deliverable. The
supervisor wants a DOCX, the conference wants a PDF from a venue's LaTeX class, the co-author
wants something they can read on a phone. None of those formats is something Node writes on its
own: DOCX and PPTX are Pandoc's, PDF is a TeX engine's, and both are large programs PhDude does
not ship, cannot vendor, and must not assume.

That leaves two questions. What happens on the machine where neither is installed — a CI runner,
a locked-down laptop, a co-author who has never heard of Pandoc? And what does "the same build"
mean, when the whole point of building twice is to know that nothing changed?

## Decision

**One port, four rules, a contract suite.** `src/ports/document-renderer.js` defines
`{ name, formats, available() → { ok, version?, hint? }, render({ input, output, cwd }) →
{ path, warnings } }` and ships `documentRendererContract`, which every adapter runs. The rules
are ordered, and the order is the interesting part:

1. A malformed request is a `VALIDATION` error — a format the renderer does not declare, an input
   file nobody wrote — **whether or not the tool is installed**. A missing tool is not what is
   wrong with a request that names a file that does not exist, and answering `TOOL_MISSING` there
   would send the researcher to install Pandoc over a typo.
2. A renderer whose tool is absent refuses with `TOOL_MISSING` carrying the install hint. It never
   renders a degraded substitute under the name of the format that was asked for.
3. It creates the output's parent directory, renders, and returns the absolute path it wrote.
4. An input it cannot honour — a CSL style handed to the built-in Markdown renderer, a
   `--reference-doc` handed to LaTeX — is a **warning naming the file**, never a silent drop.

**Markdown is built in, and that is a promise.** `src/adapters/render/markdown.js` needs nothing
installed: it resolves `[@key]`, `[@a; @b]`, `[-@key]` and `[@key, p. 3]` into plain
`(Surname, Year)` forms and appends a `## References` list, in author-year order, holding the
entries actually cited — the same rule citeproc follows. `src/domain/citations-md.js` does that
as a pure function over the entries `parseBibtex` reads back out of `references.bib`, so the
built-in path shares the registry with the Pandoc path rather than inventing a second one. It is
one fixed style and does not pretend otherwise; a venue's style is what `--csl` and Pandoc are
for. `phdude build --format md` therefore always works, on every machine, and every other format
degrades to a sentence naming the tool that would produce it.

**Precedence is an ordered list, not a lookup table.** `buildRenderers` returns
`[markdown, pandoc, latex]` and `rendererFor` takes the first renderer that declares the format.
So `md` goes to the built-in renderer *even where Pandoc is installed* — the format that must
never depend on a tool must not quietly start depending on one — and `docx`, `pptx`, `html` and
`latex` go to Pandoc, and `pdf` to the LaTeX adapter. That adapter is the one composition in the
set: it renders LaTeX through Pandoc, then compiles it with `latexmk` (or `pdflatex` twice, plus
`bibtex` when the aux file asks for it), so it is available only when *both* halves are, and its
`available()` reports whichever half is missing.

**The artifact decides, never the exit code.** LaTeX routinely exits non-zero over a warning and
still writes a PDF, and routinely exits zero having written nothing. Both renderers check the
file after the tool returns: a tool that exited 0 and wrote nothing is an `EXECUTION` failure,
because hashing whatever happens to be at that path would record a render that did not happen —
the same rule the results contract follows in [ADR 9](0009-execution-policy-and-results-contract.md).
A failure carries the last twenty lines of the tool's output as `details`, because the end of a
LaTeX log is where the error is and the beginning is the banner.

**Reproducible means byte-identical, for the formats where that is true.** Identical inputs and an
identical renderer version produce identical bytes for `md`, `latex` and `html`, and the contract
suite renders each of them twice and compares. That is what lets the build cache treat "the inputs
did not change" as "the output would not change". DOCX, PPTX and PDF are best-effort: they are ZIP
and PDF containers with timestamps inside, so the build fixes what it can — `--metadata date=` from
the manuscript rather than the clock — and the contract does not promise the rest. Pandoc 3.6 does
in fact write identical DOCX bytes for identical input, but that is Pandoc's choice to make and
not a property PhDude will hold itself to across versions.

**Every renderer's version is part of the record.** `available()` returns the tool's version, the
build cache stores it alongside the input hashes, and `phdude doctor` prints one line per renderer:
the formats it covers and either its version or the command that would install it. A document
rebuilt after a Pandoc upgrade is a document that may differ, and the cache has to know that.

## Consequences

External tools are invoked with `execFile` and an argument array, never a shell — the same rule as
[ADR 9](0009-execution-policy-and-results-contract.md) — but they are *not* behind the execution
policy. That switch guards running the researcher's own scripts, which are arbitrary code the
workspace declared; converting a Markdown file the workspace just assembled is the command doing
what it was asked to do, and gating it would mean `build` refused by default.

CI installs Pandoc (`apt-get install -y pandoc`) so the DOCX, PPTX, HTML and LaTeX paths are
exercised on every push. It does not install TeX: that is minutes of install for one format, so
the PDF tests skip there and say so. A renderer test that quietly passes on a machine without the
tool would be worse than no test at all.
