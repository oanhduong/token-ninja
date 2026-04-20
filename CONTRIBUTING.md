# Contributing to token-ninja

Thanks for your interest! This project thrives on two kinds of contribution:

1. **New rules.** The router is only as useful as its rule catalog.
2. **Safety patterns.** The deny-list should keep destructive commands from
   running locally without human review.

Everything else (classifier tweaks, new adapters, MCP features) is welcome too.

## Getting started

```bash
git clone https://github.com/oanhduong/token-ninja
cd token-ninja
npm install
npm test
```

Node 20+ required.

## Project layout

```
src/
  cli.ts                # commander entry point
  router/
    classifier.ts       # exact → prefix → regex → nl matching
    executor.ts         # execa wrapper, captures stdout/stderr
    fallback.ts         # hand off to the user's AI tool
    index.ts            # runRouter() — orchestrates safety + classify + exec
  rules/
    loader.ts           # loads builtin/*.yaml + user rules, indexes by type
    types.ts            # Rule / MatchSpec / ActionSpec
    builtin/*.yaml      # 765 production rules across 46 domains
  safety/
    denylist.ts         # hard-deny regex patterns
    validator.ts        # pipeline split + homoglyph + NFKC normalization
  adapters/             # per-AI-tool metadata + shim generation
  mcp/server.ts         # MCP stdio server (tool: maybe_execute_locally)
  telemetry/stats.ts    # local hit/miss counters, tokens-saved estimate
  config/user-config.ts # ~/.config/token-ninja/config.yaml
  utils/                # shell-parse, repo-detect, logger
tests/
  *.test.ts
  fixtures/real-commands.txt  # ≥85% of these must classify to a rule
```

## Adding a rule

Rules live in `src/rules/builtin/<domain>.yaml`. Before adding one, run:

```bash
npx tsx src/cli.ts rules test "your command"
```

to see whether an existing rule already claims it.

Pick the narrowest match type that works:

- `exact` — a fixed string (fastest, hash-indexed)
- `prefix` — command + args: `git add`, `npm install`
- `regex` — when you need capture groups: `^git\s+checkout\s+(\S+)$`
- `nl` — natural-language intent: `["show", "recent", "commits"]`

Pick the right safety tier:

- `read-only` — observation only, no filesystem or network writes
- `write-confined` — mutates files inside the working tree only
- `write-network` — installs, pushes, publishes, fetches
- `blocked` — never run locally; always fall back (rare)

Add at least one line to `tests/fixtures/real-commands.txt` that exercises
the new rule. Run `npm test` — the rules-coverage suite enforces a ≥85 % hit
rate and will tell you if your new fixture lines miss.

Finally, keep the rule/domain counts in the docs honest:

```bash
npm run rule-stats          # print current counts
npm run rule-stats:sync     # rewrite README/CONTRIBUTING/CLAUDE.md counts
npm run rule-stats:check    # CI check: exit 1 if docs are stale
```

## Adding a deny pattern

When you think of a command that MUST never run locally (e.g. a newly
popular destructive tool), add a regex to `DENY_PATTERNS` in
`src/safety/denylist.ts` and a positive test in `tests/denylist.test.ts` or
`tests/safety.test.ts`. Don't forget at least one negative test showing a
similar-looking safe command still passes.

## Coding style

- Strict TypeScript (`"strict": true` plus `noUncheckedIndexedAccess`).
- Prefer pure functions. Side effects (stats writes, stdout) live at the
  top level of the router / CLI and nowhere else.
- No secrets, credentials, or network calls in the builtin rules.
- New files should be small and single-purpose; we keep the hot path
  (classifier + safety) under a combined ~300 lines.

## Pull requests

- Run `npm run lint && npm run typecheck && npm test` before opening a PR.
- Keep commits focused. One rule batch = one PR is fine.
- Link any issues you're fixing.
- By submitting a PR you agree to license your contribution under MIT.

## Reporting security issues

Do NOT open a public issue for a deny-list bypass. Email
`security@token-ninja.dev` (or open a private security advisory on GitHub)
with a reproduction. See [SECURITY.md](SECURITY.md).
