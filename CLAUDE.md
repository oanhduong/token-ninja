# CLAUDE.md

Notes for Claude Code (and other AI coding assistants) working inside this
repository.

## What this project is

`token-ninja` is a CLI + MCP server that intercepts commands meant for an AI
coding assistant and runs the deterministic ones locally — zero LLM calls.
Anything it doesn't confidently recognize falls back to the user's AI tool
(Claude, Codex, Cursor, Aider, Gemini, Continue).

- 765 built-in rules across 46 tool domains
- Classifier hot path: ~19 µs/call; safety validator: ~4.5 µs/call (warm JIT)
- 391 tests across 28 test files; 88.0% lines / 81.0% branches /
  94.0% functions (v8 coverage over all of `src/**` except entry points and
  type-only modules; thresholds enforced at 86 / 79 / 86 / 92)

## Source layout

```
src/
  cli.ts                     # commander entry; subcommands: mcp, route, setup, uninstall, init, stats, doctor, shim, rules
  index.ts                   # public library entry (package `exports` root); importing it runs nothing
  version.ts                 # single source of the version string, read from package.json
  doctor/
    index.ts                 # `ninja doctor` health check (config, rules, shim, MCP, hook, stats)
  router/
    index.ts                 # runRouter(): safety → classify → safety (again) → exec-or-fallback
    route-once.ts            # one-shot classify+exec used by the Claude Code UserPromptSubmit hook (no AI fallback)
    classifier.ts            # exact → prefix → regex → nl matching; template expansion
    executor.ts              # execa wrapper (shell:true, captures + streams)
    fallback.ts              # hand off to user's AI tool (argv, no shell — see invariants)
  rules/
    loader.ts                # loads builtin/*.yaml + ~/.config/token-ninja/rules/*.yaml
    types.ts                 # Rule / MatchSpec / ActionSpec
    builtin/*.yaml           # 765 rules, grouped by domain (46 files)
  safety/
    denylist.ts              # DENY_PATTERNS regex list (rm -rf, sudo, curl|sh, etc.)
    validator.ts             # pipeline split + NFKC + homoglyph strip, then match
  adapters/                  # per-AI-tool metadata + shim generator (claude-code, codex, cursor, aider, gemini, continue, generic)
  setup/
    index.ts                 # orchestrates `ninja setup`: shell shim + MCP register + hook install
    shell-install.ts         # writes managed block into ~/.bashrc / ~/.zshrc
    mcp-install.ts           # registers ninja mcp with Claude Code, Cursor, Claude Desktop, Gemini CLI
    hook-install.ts          # installs Claude Code UserPromptSubmit hook
  mcp/server.ts              # stdio MCP server exposing tool: maybe_execute_locally
  telemetry/stats.ts         # hit/miss counters, tokens-saved estimate
  config/user-config.ts      # ~/.config/token-ninja/config.yaml
  utils/
    shell-parse.ts           # splitPipelineSegments, tokenize, normalizeNl
    repo-detect.ts           # detect markers (package.json, Cargo.toml, …) and PMs
    logger.ts                # ANSI-colored stderr
hooks/
  claude-code-user-prompt.cjs # shipped hook: reads a prompt, calls `ninja route`, short-circuits the model on hit
tests/                       # 28 test files, 391 tests, vitest + v8 coverage
                             # benchmark.test.ts runs via `npm run bench`, not `npm test`
  fixtures/real-commands.txt # ≥85% of these must classify (rules-coverage.test.ts)
```

## Commands

```bash
npm run build            # tsc + copy YAML rules to dist/rules/builtin/
npm run dev              # tsc -w
npm test                 # vitest run (all 391 tests; benchmarks excluded)
npm run test:watch
npm run test:coverage    # v8, thresholds: 86% lines / 79% branches / 92% functions
npm run bench            # benchmark budgets only (vitest.bench.config.ts)
npm run rule-stats:check # fail when doc counts drift (CI gate)
npm run lint             # eslint flat config
npm run typecheck        # tsc --noEmit
```

## Invariants the code relies on

- **Safety is checked twice.** Once on the raw input (`runRouter` start) and
  once on the resolved command (after template expansion). Both use the same
  `validate()`; both must pass.
- **The fallback must never re-expose what the deny-list rejected.** A
  blocked command goes straight to `fallbackToAi`, so that path spawns the AI
  tool with the input as a single argv entry and no shell. Only a non-default
  `fallback_command` uses a shell, and then `{{tool}}`/`{{input}}` are passed
  through `shellQuote()` first. Regression coverage lives in
  `tests/fallback-injection.test.ts` — do not "simplify" it back to
  `execa(str, { shell: true })`.
- **Command substitution is denied, not parsed.** `$(…)`, backticks and
  `<(…)` are deny patterns because the validator cannot know what they expand
  to. No built-in rule may emit them, or the second `validate()` will block
  its own resolved command.
- **Local execution is bounded.** `execShell` takes `timeoutMs` and
  `maxOutputBytes` (defaults in `config/user-config.ts`). The timeout kills
  the process *group*, and only detaches when stdin is already `ignore` —
  detaching an interactive command puts it in a background group where
  reading the terminal raises SIGTTIN.
- **`requires_tty` rules are never captured.** `routeOnce` returns
  `reason: "requires_tty"`; `runRouter` gives them the terminal via
  `inheritAll`.
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
  It also clears the config cache, because `custom_rules_dir` decides where
  user rules are read from.
- **`stats.json` is written atomically** (temp file + `rename`), with a
  per-call temp name. An unparseable file is moved to `stats.json.corrupt-*`
  rather than silently replaced — it holds the user's whole history.
- **The version string lives in `package.json` only.** `src/version.ts` reads
  it; `cli.ts`, `mcp/server.ts` and `doctor/` import from there. There are no
  `x-release-please-version` literals left, and adding one back means the
  three will drift again (doctor reported 0.4.1 for two releases this way).

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
- Don't make `postinstall` do anything that touches the user's machine. It
  prints next steps; `ninja setup` is the consented action. `npm install`
  under `--ignore-scripts` must still yield a working package.
- Don't add a deep path to the package `exports` map without meaning it.
  Consumers import from `token-ninja` root (`src/index.ts`); the CLI is
  reachable only through the `ninja` / `token-ninja` bins.

## Testing tips

- `npx tsx src/cli.ts rules test "your command"` — dry-runs the classifier
  without executing.
- `npx tsx src/cli.ts --dry-run "your command"` — full router, prints what
  would run.
- `npx tsx src/cli.ts doctor` — health check if something looks wrong.
- Benchmarks live in `tests/benchmark.test.ts` and run via `npm run bench`,
  not `npm test` — the budgets describe the machine as much as the code, and
  a red first `npm test` teaches contributors to ignore red. If you touch the
  classifier or safety, run them: 800ms / 10k classify, 100ms / 10k validate,
  and a regression past those usually means a new quadratic path.
- Keep doc counts honest: `npm run rule-stats:sync` rewrites the rule AND
  test counts in README / CONTRIBUTING / CLAUDE.md. `npm run rule-stats:check`
  exits 1 when stale and runs as the `docs` CI job, so adding tests means
  re-syncing. Test counts come from `vitest list --json`; do not switch it to
  grepping for `it(`, which misses every `it.each`.

## Release checklist

1. `npm run lint && npm run typecheck && npm test && npm run test:coverage`
2. Bump version in `package.json` only — `src/version.ts` reads it and
   `cli.ts` / `mcp/server.ts` / `doctor/` import from there.
3. Update `CHANGELOG.md`.
4. `npm run build`
5. `npm pack --dry-run` — confirm `dist/`, `README.md`, `LICENSE` are in.
6. `npm publish`
