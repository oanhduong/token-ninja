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

## Hardening suggestions for operators

- Keep `token-ninja` up to date.
- Review `~/.config/token-ninja/rules/` regularly. User rules are
  trust-by-author — a malicious local rule can execute anything.
- Prefer `--dry-run` when evaluating new rules: `ninja --dry-run "<cmd>"`.
- Point the MCP server only at trusted AI clients; the tool it exposes
  runs shell commands on the host.
