<div align="center">

# token-ninja

**Stop paying AI tokens for commands your shell already knows how to run.**

[![CI](https://github.com/oanhduong/token-ninja/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/oanhduong/token-ninja/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/token-ninja.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/token-ninja)
[![node](https://img.shields.io/node/v/token-ninja.svg?color=339933&logo=nodedotjs)](https://nodejs.org)
[![license: MIT](https://img.shields.io/github/license/oanhduong/token-ninja?color=blue)](LICENSE)
[![stars](https://img.shields.io/github/stars/oanhduong/token-ninja?style=flat&logo=github)](https://github.com/oanhduong/token-ninja/stargazers)
[![forks](https://img.shields.io/github/forks/oanhduong/token-ninja?style=flat&logo=github)](https://github.com/oanhduong/token-ninja/network/members)
[![contributors](https://img.shields.io/github/contributors/oanhduong/token-ninja?color=orange)](https://github.com/oanhduong/token-ninja/graphs/contributors)
[![issues](https://img.shields.io/github/issues/oanhduong/token-ninja)](https://github.com/oanhduong/token-ninja/issues)
[![last commit](https://img.shields.io/github/last-commit/oanhduong/token-ninja)](https://github.com/oanhduong/token-ninja/commits/main)
[![code style: eslint](https://img.shields.io/badge/code_style-eslint-4B32C3?logo=eslint)](eslint.config.js)
[![MCP](https://img.shields.io/badge/MCP-compatible-7C3AED)](https://modelcontextprotocol.io)

`token-ninja` is a CLI + MCP server that sits between you and your AI coding assistant
(Claude Code, Codex, Cursor, Aider, Gemini, Continue, …). It intercepts commands that are
trivially deterministic — `git status`, `npm install`, `docker ps`, `show recent commits`
— and runs them locally with **zero LLM round-trips**. Anything it doesn't confidently
recognize is handed straight to your AI tool, unchanged.

</div>

---

## Table of contents

- [Why](#why)
- [Features](#features)
- [Install](#install)
- [Quickstart](#quickstart)
- [Guide](#guide)
  - [Make it transparent with shell shims](#make-it-transparent-with-shell-shims)
  - [Writing your own rules](#writing-your-own-rules)
  - [Natural-language commands](#natural-language-commands)
  - [MCP integration](#mcp-integration)
  - [Configuration](#configuration)
- [How it works](#how-it-works)
- [Safety model](#safety-model)
- [Commands](#commands)
- [Test report](#test-report)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Why

Every trip to an LLM costs tokens, dollars, and seconds of latency. Yet a huge slice of
the commands we send AI assistants are utterly deterministic: listing files, checking
git status, running tests, showing recent commits. `token-ninja` is a thin local router
that resolves those deterministic intents against a curated rule set and executes them
straight from your shell — saving tokens on the boring stuff and keeping your AI budget
for the work that actually needs a model.

## Features

- **472+ built-in rules** across **29 tool domains** — git, GitHub CLI, npm, pnpm, yarn,
  bun, cargo, go, rust, java, kotlin, python, ruby, php, docker, kubernetes, database,
  network, filesystem, archive, process-mgmt, test-runners, linters, text-processing,
  build-tools, editors, shell, system-info, and natural-language mappings.
- **Fast**: ~37µs per classification, ~4µs per safety check on a warm JIT.
- **Safe by construction**: layered deny-list blocks destructive patterns (`rm -rf /`,
  `sudo`, `git push --force`, `DROP TABLE`, `curl | sh`, `dd if=`, `mkfs`, …) including
  homoglyph / NFKC / chained / base64-decoded evasion. Blocked inputs **never** execute
  locally — they always fall back to the AI where a human can review.
- **Pluggable**: drop a `.yaml` file into `~/.config/token-ninja/rules/` to add your own
  patterns. User rules override builtins by id.
- **MCP-native**: exposes a `maybe_execute_locally` tool so AI agents can consult the
  router *before* generating tokens.
- **Multi-assistant shims**: one-liner shell functions for `claude`, `codex`,
  `cursor-agent`, `aider`, `gemini`, and `continue`.
- **Telemetry built in**: `ninja stats` shows hit/miss counts and an estimate of tokens
  saved.
- **Zero-cost miss path**: anything the classifier doesn't confidently match is passed
  through to your AI tool untouched — no false positives.

## Install

```bash
npm install -g token-ninja
```

Requires **Node 20+**.

## Quickstart

```bash
# One-time setup: detects your installed AI tool, writes ~/.config/token-ninja/config.yaml
ninja init

# Try it
ninja "git status"             # runs locally, zero tokens
ninja "what branch am I on"    # natural-language → git branch --show-current
ninja "build the project"      # reads package.json / Cargo.toml / etc and picks the right command
ninja "rm -rf /"               # blocked — falls back to your AI for review
ninja "explain this error: …"  # doesn't match any rule — passes through to your AI

# See the damage report
ninja stats
```

## Guide

### Make it transparent with shell shims

Install a shell function so every call to `claude …`, `codex …`, etc. automatically
routes through ninja first. Ninja handles the command locally when it can, or falls
back to the real binary when it can't.

```bash
# zsh / bash
ninja shim claude >> ~/.zshrc
source ~/.zshrc

# fish
ninja shim claude --shell fish >> ~/.config/fish/config.fish

# PowerShell
ninja shim claude --shell powershell >> $PROFILE

# Now this is free for any known command, and only hits the LLM when needed:
claude "git status"
```

Available shims: `claude`, `codex`, `cursor-agent`, `aider`, `gemini`, `continue`.

### Writing your own rules

Rules are YAML. Put your own in `~/.config/token-ninja/rules/*.yaml`:

```yaml
domain: myteam
rules:
  - id: deploy-staging
    match:
      type: exact
      patterns:
        - "deploy staging"
        - "ship to staging"
    action:
      type: shell
      command: "./scripts/deploy.sh staging"
    safety: write-network

  - id: show-routes
    match:
      type: nl
      keywords:
        - ["show", "routes"]
        - ["list", "routes"]
    action:
      type: shell
      command: "rails routes | head -50"
    safety: read-only

  - id: run-script
    match:
      type: prefix
      patterns: ["run script"]
    action:
      type: shell
      command: "./scripts"
      args_passthrough: true
    safety: write-confined
```

See `src/rules/builtin/*.yaml` for **472 production-grade examples**.

- **Match types**: `exact`, `prefix`, `regex`, `nl`
- **Action types**: `shell`, `shell-detect` (pick based on repo markers), `passthrough`
  (force AI fallback)
- **Safety tiers**: `read-only` < `write-confined` < `write-network` < `blocked`
- **Template variables**: `{{input}}`, `{{args}}`, `{{arg1}}` – `{{arg9}}`,
  `{{message}}`, `{{branch}}`, `{{target}}`, `{{path}}`, `{{script}}`, `{{pkg}}`

### Natural-language commands

Many of the built-in rules match plain English, not just shell syntax:

| You type                              | Ninja runs                                    |
| ------------------------------------- | --------------------------------------------- |
| `show recent commits`                 | `git log --oneline -20`                       |
| `what branch am I on`                 | `git branch --show-current`                   |
| `list docker containers`              | `docker ps`                                   |
| `what's using port 3000`              | `lsof -i :3000`                               |
| `build the project`                   | auto-detects `npm`/`pnpm`/`cargo`/`go`/…      |
| `run the tests`                       | auto-detects the test runner                  |

Use `ninja rules test "your command"` to dry-run the classifier against any input.

### MCP integration

```bash
ninja mcp            # stdio server exposing tool: maybe_execute_locally
```

Point your AI client (Claude Desktop, Cursor, etc.) at this command to let the model
consult the router before generating tokens. The tool returns
`{handled:true, stdout, stderr, exit_code, rule_id, tokens_saved_estimate}` when a local
rule matched, or `{handled:false, reason}` when the AI should handle the request itself.

### Configuration

`~/.config/token-ninja/config.yaml`:

```yaml
default_ai_tool: claude          # fallback AI CLI
fallback_command: "{{tool}} {{input}}"
custom_rules_dir: ~/.config/token-ninja/rules
stats:
  enabled: true
  show_savings_on_exit: false
  verbose: false
```

## How it works

```
your input
    │
    ▼
safety validator ── blocked? ──► fall back to AI
    │
    ▼
classifier: exact → prefix → regex → NL keywords
    │
    ├── match  ──► re-validate resolved command ──► execShell ──► stdout
    │
    └── no match ──► fall back to AI (with the original input)
```

### Match order (strict)

1. **Exact** — `git status`, `docker ps`, `npm test` (hash-indexed, O(1))
2. **Prefix** — longest match wins: `git add src/…`, `npm install -D vitest`
3. **Regex** — captures: `^git\s+checkout\s+(\S+)$`
4. **Natural language** — keyword groups: `["show", "recent", "commits"]` →
   `git log --oneline -20`

The **first confident match wins**. Safety is checked *before* classification **and** on
the resolved command (defence-in-depth).

## Safety model

Every input is split into pipeline segments and each segment is tested against a hard
deny-list (see [`src/safety/denylist.ts`](src/safety/denylist.ts)). Matches include:

- `rm -rf` on any system path
- privilege escalation (`sudo`, `doas`)
- remote-code execution pipes (`curl | sh`, `wget | bash`, `curl | python`)
- disk destroyers (`dd if=`, `mkfs`, `> /dev/sd*`)
- git footguns (`push --force` — but not `--force-with-lease`; `reset --hard`)
- SQL footguns (`DROP TABLE`, `DELETE`/`UPDATE` without `WHERE`)
- container / cluster footguns (`docker system prune -af`, `kubectl delete` without `--dry-run`)
- **evasion tricks**: homoglyph lookalikes (`ѕudo` with Cyrillic `ѕ`), NFKC normalization
  attacks, chained `&& / ; / |`, quoted / back-ticked substitution, base64 decode
  piped to a shell

Deny-listed inputs **never execute locally** — they fall back to the AI, where a human
can review the explanation.

## Commands

```
ninja <input…>                route a command (the default)
ninja init                    interactive setup
ninja mcp                     start MCP stdio server (exposes maybe_execute_locally)
ninja stats [--json] [--reset]   show cumulative savings
ninja shim <tool> [--shell …]    print a shell function that wraps an AI tool
ninja rules list [--domain …] [--json]
ninja rules test <input…>     dry-run the classifier

Global options:
  -v, --verbose              verbose stderr logging
  --dry-run                  print the resolved command, don't execute
  --ai <tool>                override fallback tool
  --no-fallback              fail non-zero on a miss instead of calling AI
  --json                     machine-readable output
```

## Test report

`token-ninja` is a shell-adjacent tool — correctness and safety are non-negotiable. The
test suite is the safety net.

| Metric                       | Value                              |
| ---------------------------- | ---------------------------------- |
| Test files                   | **14**                             |
| Tests                        | **198** (all passing)              |
| Line coverage                | **89.5%** &nbsp;(threshold: 85%)   |
| Branch coverage              | **83.6%** &nbsp;(threshold: 80%)   |
| Function coverage            | **100%** &nbsp;(threshold: 95%)    |
| Statement coverage           | **89.5%** &nbsp;(threshold: 85%)   |
| Real-command fixture hit-rate | **≥85%** enforced                 |
| classify() benchmark          | **~37 µs/call** (10k in <800 ms) |
| validate() benchmark          | **~4 µs/call**  (10k in <100 ms) |

Coverage is enforced by `vitest` + `@vitest/coverage-v8` against `src/router/**`,
`src/safety/**`, and `src/rules/**`. Pipeline gates (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

- `lint` — ESLint flat config, typed rules
- `typecheck` — `tsc --noEmit`
- `build` — emits `dist/`, copies YAML rules, runs `npm pack --dry-run`
- `test` — Node 20 & 22 on `ubuntu-latest`, plus Node 20 on `macos-latest`
- `coverage` — uploaded as a workflow artifact

Benchmark assertions scale automatically on CI (`BENCH_FACTOR` auto-detected); run
`BENCH_FACTOR=1 npm test` locally for strict regression numbers, or set `SKIP_BENCH=1`
to treat benchmarks as informational only.

## Development

```bash
git clone https://github.com/oanhduong/token-ninja
cd token-ninja
npm install

npm run lint             # eslint flat config
npm run typecheck        # tsc --noEmit
npm run build            # tsc + copy YAML rules to dist/
npm test                 # vitest run, 198 tests
npm run test:watch       # watch mode
npm run test:coverage    # v8 coverage, thresholds enforced
```

Handy development commands:

```bash
# Dry-run the classifier (no execution)
npx tsx src/cli.ts rules test "your command"

# Full router dry-run (prints the resolved command)
npx tsx src/cli.ts --dry-run "your command"

# List built-in rules
npx tsx src/cli.ts rules list --domain git
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New rules are always welcome — the fastest way
to help is to browse [`tests/fixtures/real-commands.txt`](tests/fixtures/real-commands.txt)
for commands that currently miss and add a rule covering them.

1. Pick the narrowest match type (`exact` > `prefix` > `regex` > `nl`).
2. Pick the right safety tier (`read-only` < `write-confined` < `write-network` < `blocked`).
3. Add at least one fixture line to `tests/fixtures/real-commands.txt`.
4. `npm test` — the coverage suite enforces a ≥85% hit rate on fixtures.

Security issues: please see [SECURITY.md](SECURITY.md). Community norms: see
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

MIT — see [LICENSE](LICENSE).
