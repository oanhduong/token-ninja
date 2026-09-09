# Security Policy

## Scope

`token-ninja` routes commands locally instead of shipping them to an AI.
The security-critical piece is the safety validator: if a destructive
command slips past the deny-list AND matches a local rule, it runs on the
user's machine without confirmation.

We treat any deny-list bypass as a security issue, including:

- A new command class that should be blocked but isn't (e.g. a file-system
  or privilege tool we don't know about).
- An evasion technique against existing patterns: quoting, chaining,
  encoding, unicode lookalikes, command substitution, shell features that
  skip pipeline splitting.
- An MCP input sequence that causes the server to execute outside its
  intended sandbox.
- A rule whose action template expands user input into a deny-listed
  command (the router re-validates the resolved command, but if that
  check is bypassable, that's also a bug here).
- Anything that lets a **rejected** command reach a shell. A deny-list hit
  falls back to the AI tool, so that handoff is part of the security
  boundary: it spawns the tool with the input as a single argv entry and no
  shell. (Through 0.5.1 it interpolated the input into a shell command
  unquoted, which made every deny pattern advisory — fixed in 0.6.0,
  regression tests in `tests/fallback-injection.test.ts`.)

Out of scope: slow regexes, cosmetic CLI issues, coverage reporting.

## Supported versions

Active development lives on `main`. Security fixes are backported to the
most recent minor release only.

## Reporting

Please report privately. Options, in order of preference:

1. Open a private security advisory on GitHub:
   https://github.com/token-ninja/token-ninja/security/advisories/new
2. Email `security@token-ninja.dev` with "token-ninja" in the subject.

Include:
- A minimal reproduction (command string that bypasses the validator)
- Which deny pattern you'd expect to fire
- Your Node version and OS

We will acknowledge within 72 hours and aim to ship a fix within 14 days
for critical issues. Embargoed disclosure is fine.

## Dependency policy

`npm audit` on **production** dependencies is the blocking CI gate — those are
the packages installed on a user's machine next to a tool that runs shell
commands. Dev-dependency advisories are reported but not blocking: the
outstanding ones are in the vitest chain, and clearing them requires vitest 5,
which needs Node >=22.12 and would drop this package's Node 20 support. They
do not ship in the published tarball.

`dependency-review-action` is configured but skipped: it requires Dependency
graph to be enabled on the repository (and GitHub Advanced Security for a
private repo). Enable that, then set the `DEPENDENCY_REVIEW=true` Actions
variable to turn the job on — `.github/workflows/ci.yml` carries the steps.

## Hardening suggestions for operators

- Keep `token-ninja` up to date.
- Review `~/.config/token-ninja/rules/` regularly. User rules are
  trust-by-author — a malicious local rule can execute anything.
- Prefer `--dry-run` when evaluating new rules: `ninja --dry-run "<cmd>"`.
- Point the MCP server only at trusted AI clients; the tool it exposes
  runs shell commands on the host.
- Local execution is bounded by `exec.timeout_ms` and
  `exec.max_output_bytes` in `config.yaml`. Lower them if you expose the MCP
  server to an agent you do not fully control.
