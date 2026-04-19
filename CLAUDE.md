# CLAUDE.md

Notes for Claude Code (and other AI coding assistants) working inside this
repository.

## What this project is

`token-ninja` is a CLI + MCP server that intercepts commands meant for an AI
coding assistant and runs the deterministic ones locally — zero LLM calls.
Anything it doesn't confidently recognize falls back to the user's AI tool
(Claude, Codex, Cursor, Aider, Gemini, Continue).

- 472 built-in rules across 29 tool domains
- Classifier hot path: ~37µs/call; safety validator: ~4µs/call
- 198 tests, 89.5% line coverage enforced on `src/router/**`,
  `src/safety/**`, `src/rules/**`

## Source layout

```
src/
  cli.ts                     # commander entry; subcommands: mcp, init, stats, shim, rules
  router/
    index.ts                 # runRouter(): safety → classify → safety (again) → exec
    classifier.ts            # exact → prefix → regex → nl matching; template expansion
    executor.ts              # execa wrapper (shell:true, captures + streams)
    fallback.ts              # hand off to user's AI tool
  rules/
    loader.ts                # loads builtin/*.yaml + ~/.config/token-ninja/rules/*.yaml
    types.ts                 # Rule / MatchSpec / ActionSpec
    builtin/*.yaml           # 472 rules, grouped by domain
  safety/
    denylist.ts              # DENY_PATTERNS regex list (rm -rf, sudo, curl|sh, etc.)
    validator.ts             # pipeline split + NFKC + homoglyph strip, then match
  adapters/                  # per-AI-tool metadata + shim generator
  mcp/server.ts              # stdio MCP server exposing tool: maybe_execute_locally
  telemetry/stats.ts         # hit/miss counters, tokens-saved estimate
  config/user-config.ts      # ~/.config/token-ninja/config.yaml
  utils/
    shell-parse.ts           # splitPipelineSegments, tokenize, normalizeNl
    repo-detect.ts           # detect markers (package.json, Cargo.toml, …) and PMs
    logger.ts                # ANSI-colored stderr
tests/                       # 14 test files, ~200 tests, vitest + v8 coverage
  fixtures/real-commands.txt # ≥85% of these must classify (rules-coverage.test.ts)
```

## Commands

```bash
npm run build            # tsc + copy YAML rules to dist/rules/builtin/
npm run dev              # tsc -w
npm test                 # vitest run (all 198 tests)
npm run test:watch
npm run test:coverage    # v8, thresholds: 85% lines, 80% branches, 95% functions
npm run lint             # eslint flat config
npm run typecheck        # tsc --noEmit
```

## Invariants the code relies on

- **Safety is checked twice.** Once on the raw input (`runRouter` start) and
  once on the resolved command (after template expansion). Both use the same
  `validate()`; both must pass.
- **Match order is strict**: exact → prefix → regex → nl. Longest-prefix
  wins inside the prefix phase. First confident match wins overall.
- **`args_passthrough: true`** means: if the rule's base command is a prefix
  of the user's input, run the full input (preserving flags like `-D`);
  otherwise normalize (`git st` → `git status`) and append captured args.
  Do not regress this — see `tests/classifier-templates.test.ts`.
- **User rules override builtins** by id. Loader warns on duplicates; the
  later-defined rule wins.
- **The rule cache is memoized.** Tests that load rules multiple times
  should call `invalidateRulesCache()` in `beforeEach` if they mutate state.

## Adding a rule

1. Find the right domain file in `src/rules/builtin/<domain>.yaml`.
2. Choose the narrowest match type: `exact` > `prefix` > `regex` > `nl`.
3. Choose the right safety tier: `read-only` < `write-confined` <
   `write-network` < `blocked`.
4. Add at least one fixture line in `tests/fixtures/real-commands.txt`.
5. `npm test` — the coverage suite enforces ≥85% hit rate.

## Adding a deny pattern

1. Add a regex to `DENY_PATTERNS` in `src/safety/denylist.ts`. Case-insensitive
   flag is enforced by a test.
2. Add a positive test to `tests/denylist.test.ts` or `tests/safety.test.ts`.
3. Add a negative test confirming a similar-looking safe command still passes.

## Things NOT to do

- Don't add runtime dependencies casually. Current deps: `commander`, `execa`,
  `yaml`, `@modelcontextprotocol/sdk`. Every new one is a supply-chain risk
  for a tool that runs shell commands.
- Don't `mkdir -p` outside `configDir()` or `process.cwd()`. The tool is
  careful to touch only `~/.config/token-ninja/*`.
- Don't add logging on the hot path. `logger.debug` is fine (guarded by
  `verbose`), but anything unconditional on stdout/stderr will show up in
  every MCP response and every shim call.
- Don't change the `stats.json` schema without bumping `version` and
  handling the migration in `readStats`.

## Testing tips

- `npx tsx src/cli.ts rules test "your command"` — dry-runs the classifier
  without executing.
- `npx tsx src/cli.ts --dry-run "your command"` — full router, prints what
  would run.
- Benchmarks live in `tests/benchmark.test.ts`. If you touch the classifier
  or safety, re-run them locally: thresholds are generous (800ms / 10k
  classify, 100ms / 10k validate) but a regression past those usually
  means a new quadratic path.

## Release checklist

1. `npm run lint && npm run typecheck && npm test && npm run test:coverage`
2. Bump version in `package.json` and `src/cli.ts` (`.version("…")`) and
   `src/mcp/server.ts` (server init).
3. Update `CHANGELOG.md`.
4. `npm run build`
5. `npm pack --dry-run` — confirm `dist/`, `README.md`, `LICENSE` are in.
6. `npm publish`
