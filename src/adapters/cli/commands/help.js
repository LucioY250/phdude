const LINES = [
  'phdude - the senior researcher in your terminal',
  '',
  'Usage: phdude <command> [options]',
  '',
  'Commands:',
  '  init [dir]                        create a research workspace here or in <dir>',
  '  bootstrap                         ingest, detect packs, then hand off to the agent',
  '  ingest [paths...]                 inventory, hash and extract sources/ (default)',
  '  status                            project, inventory, knowledge, conflicts, decisions',
  '  next                              the highest-impact next action, with reasons',
  '  knowledge list|show|trace         query the knowledge graph',
  '  add <type>                        add claim, evidence, fact, source, question,',
  '                                    hypothesis, method, result or artifact-role',
  '  link <id> --to <id>…              attach evidence, questions or artifacts to an object',
  '  decide propose|approve|reject|supersede',
  '                                    research decisions; the researcher decides',
  '  promote <id> --decision <DEC-id>  move an object to canonical',
  '  cite list|check|export            citation registry: list, verify, export BibTeX/CSL',
  '  research "<query>"|list|show|accept|dismiss',
  '                                    search the literature; review what came back',
  '           [--question RQ-n] [--provider p,p] [--from YYYY] [--limit N]',
  '           [--type t] [--approve-preprint] [--reason "…"]',
  '           [--allow-network]        nothing leaves the machine unless the policy allows it',
  '  research-fresh [--question RQ-n]  re-run the searches that have gone stale',
  '                 [--all] [--allow-network]',
  '  freshness                         last search per question, age per source, what is stale',
  "  edit <id> --json '<fields>'       correct the non-identity fields of a non-canonical object",
  '  matrix [--format md|csv]          literature matrix: one row per source',
  '         [--question RQ-n]          (optionally filtered to a research question)',
  '  gaps                              research gaps: questions, claims, sources, conflicts',
  '  prose --file <path> [--lang c]    academic prose quality report: six scores, located',
  '                                    observations, and what to do about each one',
  '  manuscript init|list|show <s>|status',
  '                                    the manuscript: sections, their status, the approvals',
  '             submit <s> --file f [--revision]',
  '                                    run the writing gates over a draft and record it',
  '             approve <s> --decision DEC-id | reopen <s>',
  '                                    approve a section, or reopen an approved one',
  '  packs list|detect|apply <name>    field and method packs',
  '  mode lite|full|ruthless|off       set the review mode',
  '  migrate [--dry-run] [--force]     upgrade the workspace to the current schema version',
  '  doctor                            adapters, cache, schema versions, git state',
  '  help                              show this message',
  '',
  'Global options:',
  '  --json                            machine-readable output',
  '  --workspace <dir>                 run against another workspace',
  '  --actor researcher=<name>,agent=<host>',
  '                                    override the recorded actor',
  '  --version                         print the version',
  '',
  'Exit codes: 0 ok, 1 usage, 2 validation, 3 policy, 4 external tool missing.',
  'Full reference: docs/cli.md',
];

/**
 * @returns {string}
 */
export function usage() {
  return LINES.join('\n') + '\n';
}

export default async function help() {
  return { text: usage(), json: { usage: usage() } };
}
