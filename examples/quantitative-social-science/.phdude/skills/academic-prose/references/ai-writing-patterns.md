# AI writing patterns

The patterns `phdude prose` detects, what each one costs a reader, and what to write instead.
Every rule below is deterministic and located: it names a line and quotes the sentence, so you
can open it and disagree.

None of this is about looking human to a detector (PRD §30c). Each pattern is a real defect in
academic prose: a sentence that asserts without evidence, a paragraph that connects without
arguing, a phrase that occupies space without saying anything.

## The rules

| Rule | Fires when | Fix |
| --- | --- | --- |
| `transition-density` | More than 40% of a paragraph's sentences open with a connective, in a paragraph of at least three sentences. | Delete the connective where the logical turn is not real. A paragraph that argues does not need "Furthermore" to hold together. |
| `sentence-monotony` | A paragraph of at least five sentences whose lengths vary by less than 3 words (standard deviation). | Join two short sentences, or split the longest at its real break. Uniform length reads as a template. |
| `repeated-openings` | Three or more sentences in one paragraph open with the same two words. | Rewrite all but one. "This research is…" five times is a list wearing a paragraph's clothes. |
| `banned-phrase` | A phrase from the per-language generic-register list appears. | Say what was done, found or argued. |
| `empty-phrase` | Filler that can be deleted without losing meaning. | Delete it and keep the sentence. |
| `unsupported-intensifier` | An intensifier ("significant", "crucial", "novel", "robust") in a sentence with no `[@citation]` and no `<!-- fact: -->` / `<!-- result: -->` marker. | Cite the source, mark the number, or drop the adjective. Importance is shown, not asserted. |
| `vague-literature` | A claim about a body of work ("studies show", "the literature suggests") with no citation in the sentence. | Name the studies with `[@bibkey]`, or say what was found and where. |
| `symmetrical-lists` | Three or more consecutive list items open with the same word. | Vary the openings, or fold the list back into prose that argues rather than enumerates. |
| `excessive-hedging` | Three or more hedges in one sentence. | State the claim once, at the strength the evidence supports. Stacked hedges read as no claim at all. |

## English

**Generic register.** "delve into", "in the realm of", "plays a crucial role", "a testament to",
"navigating the complexities", "paradigm shift", "underscores the importance", "ever-evolving",
"at the forefront of", "unlock the potential", "harness the power", "rich tapestry".

**Filler.** "it is important to note", "it should be noted that", "it is worth noting that",
"as previously mentioned", "needless to say", "due to the fact that", "in order to",
"in terms of", "a wide range of", "when it comes to", "first and foremost",
"last but not least", "basically", "essentially".

**Vague literature.** "studies show", "research has demonstrated", "the literature suggests",
"many studies", "several researchers", "previous work has", "recent studies",
"a growing body of research", "it is widely accepted", "experts agree".

**Unsupported intensifiers.** "significant(ly)", "crucial(ly)", "critical(ly)", "essential",
"vital", "robust", "novel", "cutting-edge", "groundbreaking", "unprecedented", "remarkable",
"substantial", "profound", "compelling", "striking", "pivotal", "paramount", "highly",
"extremely".

**Over-used connectives.** "Furthermore", "Moreover", "Additionally", "In addition",
"Overall", "In conclusion", "Notably", "Importantly", "Ultimately".

## Español

**Registro genérico.** "en el mundo actual", "en la era digital", "en un mundo cada vez más",
"juega un papel crucial", "desempeña un papel fundamental", "cambio de paradigma",
"subraya la importancia", "a la vanguardia de", "en constante evolución", "aprovechar el poder",
"adentrarse en", "un sinfín de".

**Relleno.** "es importante señalar que", "cabe mencionar que",
"como se mencionó anteriormente", "debido al hecho de que", "con el fin de", "en términos de",
"una amplia gama de", "una gran variedad de", "en última instancia", "a fin de cuentas".

**Literatura vaga.** "los estudios han demostrado", "la literatura sugiere", "muchos estudios",
"varios investigadores", "estudios previos", "investigaciones recientes",
"se ha demostrado ampliamente", "un creciente cuerpo de literatura", "los expertos coinciden".

**Intensificadores sin respaldo.** "significativo/a(mente)", "crucial", "fundamental",
"esencial", "vital", "robusto", "novedoso", "innovador", "revolucionario", "sin precedentes",
"notable", "sustancial", "profundo", "clave", "altamente", "extremadamente", "de vanguardia".

**Conectores sobreusados.** "Además", "Asimismo", "Por otro lado", "Sin embargo",
"En consecuencia", "En conclusión", "Por último", "De hecho".

Spanish drops the subject pronoun, so the first-person rate undercounts: "analizamos" carries a
first person that "we analyzed" spells out. Compare a Spanish text's rate with other Spanish
texts, never with an English one.

## Other languages

A language with no table here runs only the structural rules - `sentence-monotony`,
`repeated-openings`, `symmetrical-lists` - and the report says so as an `info` observation. The
evidence and epistemic gates are language-neutral and still apply in full.
