# Security policy

## Reporting a vulnerability

Report privately, through GitHub:
**[open a security advisory](https://github.com/LucioY250/phdude/security/advisories/new)**.
That form is private between you and the maintainer, and it is the only private channel this
repository has. Please do not open a public issue for a vulnerability, and please do not post one
to a mailing list or a social account before it is fixed.

Include, as far as you can:

- what an attacker gets, and what they need in order to get it;
- the PhDude version (`phdude --version`) and the Node version;
- the smallest sequence of commands that reproduces it, ideally against a workspace made by
  `phdude init` rather than one of your own;
- anything the workspace had to be configured to allow, such as `--allow-network` or an open
  execution policy.

You will get a first response within seven days. If a report is confirmed, we will agree a
disclosure date with you, fix it in a patch release, and credit you in the CHANGELOG unless you
would rather not be named.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | yes       |
| < 1.0   | no        |

PhDude follows [SemVer](docs/versioning.md). Security fixes land on the latest minor of the
current major; there are no long-term-support branches for earlier majors, and there is no earlier
major yet.

## What counts as a vulnerability

PhDude is a local tool. It has no server, no accounts and no cloud component, so the interesting
boundaries are the ones between your workspace and everything outside it:

- **Anything executed that you did not ask to execute.** Analyses and figure generators run only
  under the execution policy and only through `execFile` with an argument array, never a shell.
  A path that reaches a shell, or that runs a script the policy did not allow, is a vulnerability.
- **Anything leaving the machine that you did not ask to send.** Only a search provider, the
  Crossref DOI lookup and `git clone` can reach the network, and only when `--allow-network` and
  the research policy both allow it. A request made without that is a vulnerability.
- **Anything written outside the workspace.** Every write goes through the store, atomically, to
  a path inside the workspace root. A traversal that escapes it — through an ingested archive, an
  installed skill, a pack, a template — is a vulnerability.
- **Installed skills and packs.** `phdude skills install` copies files and validates the contract
  before a byte lands; nothing in a skill is ever executed by PhDude. Anything that makes an
  installed skill or pack execute is a vulnerability.
- **Recorded state that lies.** An input that makes PhDude record a claim, a citation or an event
  that misrepresents what happened — a forged provenance chain, an event log that can be rewritten
  in place — is a vulnerability, because the record is the product.

## What does not count

- A crash or a stack trace on malformed input, with no privilege gained. That is a bug; open a
  normal issue.
- Anything that requires the attacker to already be able to write to your workspace or run code
  as you. PhDude trusts its own workspace, the way `git` trusts its own repository.
- Findings against a dependency that has no path from PhDude's own code. Report those upstream.
  CI runs `npm audit` and Dependabot watches the manifest.
- Anything about AI-detector evasion. PhDude has no detector surface by design
  ([docs/non-goals.md](docs/non-goals.md)), and a request to add one is refused rather than fixed.
