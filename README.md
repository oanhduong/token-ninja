<div align="center">

# token&#8209;ninja

### Stop paying AI tokens for commands your shell already knows how to run.

`token-ninja` is a deterministic router that sits between you and your AI coding
assistant. Commands like `git status`, `npm install`, `docker ps`, or
`show recent commits` are resolved locally with **zero LLM calls**.
Anything it doesn't confidently recognize is passed straight through to your AI —
unchanged, uninterrupted.

[![CI](https://github.com/oanhduong/token-ninja/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/oanhduong/token-ninja/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/token-ninja.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/token-ninja)
[![downloads](https://img.shields.io/npm/dw/token-ninja.svg?color=cb3837&logo=npm&label=downloads)](https://www.npmjs.com/package/token-ninja)
[![node](https://img.shields.io/node/v/token-ninja.svg?color=339933&logo=nodedotjs)](https://nodejs.org)
[![license](https://img.shields.io/github/license/oanhduong/token-ninja?color=blue)](LICENSE)
[![stars](https://img.shields.io/github/stars/oanhduong/token-ninja?style=flat&logo=github)](https://github.com/oanhduong/token-ninja/stargazers)
[![issues](https://img.shields.io/github/issues/oanhduong/token-ninja)](https://github.com/oanhduong/token-ninja/issues)
[![last commit](https://img.shields.io/github/last-commit/oanhduong/token-ninja)](https://github.com/oanhduong/token-ninja/commits/main)
[![MCP](https://img.shields.io/badge/MCP-compatible-7C3AED)](https://modelcontextprotocol.io)

[**Install**](#install) · [**Quickstart**](#quickstart) · [**How it works**](#how-it-works) · [**Rules**](#write-your-own-rules) · [**MCP**](#mcp-integration) · [**Safety**](#safety-model) · [**Benchmarks**](#benchmarks)

</div>

---

```console
# Inside your Claude Code (or Cursor / Claude Desktop) session — just chat as usual.
# token-ninja watches every shell call the agent tries to make and handles the
# deterministic ones locally, without ever hitting the model.

you  › what branch am I on?
ai   › (asks token-ninja) git branch --show-current
     ⚡ ninja handled locally (git-branch-current) · saved ~420 tokens
     main

you  › how's the test suite doing?
ai   › (asks token-ninja) npm test
     ⚡ ninja handled locally (npm-test) · saved ~480 tokens
     Tests  234 passed (234)

you  › explain this stack trace: …
ai   › (token-ninja: no match — passing through to the model)
     …regular model reply…
```

No prefix. No new commands to learn. Keep chatting with `claude`, `codex`,
`cursor`, `aider`, `gemini`, `continue` the way you already do — token-ninja
quietly handles the boring stuff and gets out of the way for everything else.

---

## Table of contents

- [Why token-ninja](#why-token-ninja)
- [Install](#install)
- [Quickstart](#quickstart)
- [How it works](#how-it-works)
- [Features](#features)
- [Supported AI tools](#supported-ai-tools)
- [Write your own rules](#write-your-own-rules)
- [Natural-language commands](#natural-language-commands)
- [MCP integration](#mcp-integration)
- [Configuration](#configuration)
- [Safety model](#safety-model)
- [Commands](#commands)
- [Benchmarks](#benchmarks)
- [Development](#development)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

---

## Why token-ninja

Every trip to an LLM costs tokens, dollars, and seconds of latency. Yet a huge
share of what we ask AI coding assistants is utterly deterministic — listing
files, checking git status, running tests, showing recent commits. Those calls
don't need a model. They need a shell.

|                                    | Plain AI assistant | **token-ninja**            |
| ---------------------------------- | :----------------: | :------------------------: |
| `git status`                       | ~400 tokens        | **0 tokens, ~10 ms**       |
| `docker ps`                        | ~450 tokens        | **0 tokens, ~10 ms**       |
| `show recent commits`              | ~500 tokens        | **0 tokens, ~15 ms**       |
| `build the project` *(auto-detects `npm` / `cargo` / `go` / …)* | ~700 tokens        | **0 tokens, ~20 ms**       |
| `rm -rf /`                         | runs if model agrees | **blocked before exec**  |
| `explain this stack trace: …`      | ~2–5 k tokens      | passes straight through    |

The classifier runs in **~19 µs**. The safety validator runs in **~10 µs**.
Neither will ever be the slow part of your day.

## Install

**One line. Zero config. Starts working on your next AI session.**

```bash
npm install -g token-ninja
```

A postinstall hook registers `ninja mcp` as an MCP server in every AI client
it can find on your machine — Claude Code (`~/.claude.json`), Cursor
(`~/.cursor/mcp.json`), and Claude Desktop — so the next time you open your
AI tool, it already knows to consult token-ninja before spending tokens on
commands like `git status`, `npm test`, or `docker ps`.

For **Claude Code** specifically, the same postinstall also writes a
`UserPromptSubmit` hook into `~/.claude/settings.json`. That event fires
*before* your prompt turns into an API call — if token-ninja recognizes it
with high confidence (exact or prefix match), the hook executes locally
and short-circuits the model entirely. The prompt is never sent, the
response is never generated: **zero input tokens, zero output tokens.**
Anything conversational flows through to Claude untouched.

Existing MCP entries are preserved, each file is backed up once
(`*.token-ninja.bak`) before the first write, and malformed configs are
skipped safely instead of failing the install.

> **Requirements:** Node ≥ 20.
>
> **Opt out of the postinstall hook entirely:**
> `TOKEN_NINJA_SKIP_POSTINSTALL=1 npm install -g token-ninja`
>
> **Roll back any time:** `ninja uninstall` — removes the MCP entry from
> every client config it wrote to, and the UserPromptSubmit hook from
> `~/.claude/settings.json`.

## Quickstart

**There's no new command to learn.** After `npm install -g token-ninja`,
open your AI tool the way you always do and start chatting:

```console
you  › are there any uncommitted changes?
ai   ⚡ handled by token-ninja (git-status) · saved ~512 tokens
     On branch main
     nothing to commit, working tree clean

you  › list the recent commits on this branch
ai   ⚡ handled by token-ninja (git-log-recent) · saved ~500 tokens
     9e1c3b4  feat(setup): auto-register ninja mcp
     48f6643  feat(rules): expand coverage with 10 new domains
     …

you  › what's using port 3000?
ai   ⚡ handled by token-ninja (port-usage) · saved ~438 tokens
     node    4812  alice   21u  IPv6  *:3000 (LISTEN)

you  › why is my React state not updating when I click the button?
ai   # No match — token-ninja passes through. The model answers normally.
```

Check how many tokens you've saved at any time:

```bash
ninja stats
```

Handy extras:

- `ninja rules test "your command"` — dry-run the classifier against any
  input (no execution) and see which rule would fire.
- `ninja setup` — re-run auto-setup; `ninja setup --dry-run` previews without
  writing; `ninja setup --no-mcp` skips MCP registration.
- `ninja uninstall` — remove everything token-ninja added.

## How it works

```text
your input
    │
    ▼
┌────────────────────┐    blocked?    ┌──────────────────────┐
│  safety validator  │ ─────────────► │  fall back to AI     │
└────────────────────┘                │  (let a human review) │
    │ allowed                         └──────────────────────┘
    ▼
┌────────────────────┐    no match    ┌──────────────────────┐
│   classifier       │ ─────────────► │  fall back to AI     │
│ exact → prefix →   │                │  (pass unchanged)    │
│ regex → NL         │                └──────────────────────┘
└────────────────────┘
    │ match
    ▼
┌────────────────────┐    blocked?    ┌──────────────────────┐
│  safety (again, on │ ─────────────► │  fall back to AI     │
│ resolved command)  │                └──────────────────────┘
└────────────────────┘
    │ allowed
    ▼
┌────────────────────┐
│  exec in your      │  ──► stdout / stderr
│  shell, record hit │  ──► ninja saved ~N tokens
└────────────────────┘
```

**Match order is strict**: exact → prefix → regex → natural-language keywords.
The first confident match wins. Safety is checked **twice** — on the raw input
and on the resolved command — so template expansion can never smuggle a
dangerous command past the classifier.

## Features

- **Hundreds of built-in rules** across dozens of tool domains — git, GitHub
  CLI, npm, pnpm, yarn, bun, cargo, go, rust, java, kotlin, python, ruby, php,
  docker, kubernetes, database, network, filesystem, archive, process
  management, test runners, linters, text processing, build tools, editors,
  shell utilities, system info, **cloud CLIs (AWS, Azure, gcloud, Vercel,
  Netlify, Heroku, Fly, Railway, doctl)**, **IaC (Terraform, Ansible, Vagrant,
  Pulumi, Packer, CDK)**, **bundlers (Vite, Turbo, esbuild, Parcel, Rollup,
  Webpack, Rspack, tsup, Nx)**, **Deno / Elixir / Dart / Flutter**, **process
  supervisors (pm2, systemctl --user, journalctl, overmind)**, **env managers
  (direnv, asdf, mise, pyenv, rbenv, nix, conda)**, **distributed systems
  (consul, etcd, zookeeper, NATS, Kafka, RabbitMQ)**, and natural-language
  mappings. Run `ninja rules list` to see everything loaded.
- **Fast**: ~19 µs per classification, ~10 µs per safety check (warm JIT).
- **Safe by construction**: layered deny-list blocks `rm -rf /`, `sudo`,
  `git push --force`, `DROP TABLE`, `curl | sh`, `dd if=`, `mkfs`, … including
  homoglyph, NFKC, chained, and base64-decoded evasion.
- **Zero-setup**: `npm install -g` is literally the whole install. A
  postinstall hook registers token-ninja as an MCP server in every AI client
  it can detect; `ninja uninstall` reverses it.
- **Transparent UX**: nothing changes about how you use your AI tool. The
  only thing you notice is a small "⚡ handled by token-ninja" line when a
  deterministic command gets answered for free.
- **MCP-native**: exposes `maybe_execute_locally` over stdio so AI agents
  consult the router *before* generating tokens.
- **Pluggable**: drop a `.yaml` into `~/.config/token-ninja/rules/` to add
  your own patterns. User rules override builtins by id.
- **Telemetry built in**: `ninja stats` shows hit rate, top rules, and an
  estimate of the tokens you've saved to date.
- **Dry-run friendly**: `ninja rules test "…"` shows which rule would fire
  for any input, without executing anything.

## Supported AI tools

Auto-registered by `ninja setup` out of the box:

| Tool            | Config file token-ninja writes to                                      |
| --------------- | ---------------------------------------------------------------------- |
| Claude Code     | `~/.claude.json`                                                       |
| Cursor          | `~/.cursor/mcp.json`                                                   |
| Claude Desktop  | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%\Claude\…` (Windows), `$XDG_CONFIG_HOME/Claude/…` (Linux) |

Any other MCP-capable client works too — point it at `ninja mcp` and you're
in. Installed a new AI tool later? Re-run `ninja setup`; it's idempotent.

## Write your own rules

Rules are plain YAML. Drop a file into `~/.config/token-ninja/rules/*.yaml`:

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

See [`src/rules/builtin/*.yaml`](src/rules/builtin) for **472 production-grade
examples**.

| Match type | When to use                                                        |
| ---------- | ------------------------------------------------------------------ |
| `exact`    | The input must equal one of the patterns (hash-indexed, O(1)).     |
| `prefix`   | The input starts with one of the patterns; longest match wins.     |
| `regex`    | Arbitrary capture groups. Used for templated commands.             |
| `nl`       | Natural-language keyword groups, e.g. `["show", "recent", "commits"]`. |

| Safety tier        | Means                                                 |
| ------------------ | ----------------------------------------------------- |
| `read-only`        | Cannot modify the user's filesystem.                  |
| `write-confined`   | Writes only inside CWD / config dir / build outputs.  |
| `write-network`    | May reach the network (e.g. `npm install`).           |
| `blocked`          | Never execute locally; always fall back to AI.        |

**Template variables** available in `command:`
`{{input}}`, `{{args}}`, `{{arg1}}` … `{{arg9}}`, `{{message}}`, `{{branch}}`,
`{{target}}`, `{{path}}`, `{{script}}`, `{{pkg}}`.

## Natural-language commands

Many built-in rules match plain English, not just shell syntax:

| You type                   | Ninja runs                                  |
| -------------------------- | ------------------------------------------- |
| `show recent commits`      | `git log --oneline -20`                     |
| `what branch am I on`      | `git branch --show-current`                 |
| `list docker containers`   | `docker ps`                                 |
| `what's using port 3000`   | `lsof -i :3000`                             |
| `build the project`        | auto-detects `npm` / `pnpm` / `cargo` / `go` / … |
| `run the tests`            | auto-detects the test runner                |

Use `ninja rules test "your command"` to dry-run the classifier against any input.

## MCP integration

token-ninja talks to most AI tools through the Model Context Protocol: it
exposes a single stdio tool (`maybe_execute_locally`) that the agent calls
on every command it's about to run. If token-ninja recognizes the command,
it answers with the output directly; if not, the agent proceeds as usual.

### Claude Code: UserPromptSubmit hook (real savings)

The MCP server alone doesn't save tokens in Claude Code because the model
rarely consults MCP tools before the Bash built-in, and once a tool result
is in context it counts the same tokens whether it came from Bash or an
MCP call. To save real tokens we have to intercept *before* the prompt
becomes an API call. That's what the `UserPromptSubmit` hook does:

```jsonc
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node /abs/path/to/hooks/claude-code-user-prompt.cjs" }
        ]
      }
    ]
  }
}
```

Every prompt you type passes through `ninja route --strict` first. If a
high-confidence rule matches, the command runs locally and the captured
output is rendered back to you — **the model is never invoked, no input
tokens consumed, no output tokens generated.** If nothing matches, the
prompt flows to Claude unchanged. A real turn-level save, not a cosmetic
one.

**Safeguards against mis-interception.** Conversational prompts should
never be hijacked, so the hook layers five filters:

1. **Strict routing** — only `exact` and `prefix` matches (no NL, no regex).
2. **Length cap** — prompts longer than 80 chars skip (literal commands are short).
3. **Keyword blocklist** — `explain`, `why`, `how`, `review`, `suggest`,
   `teach`, `help me`, `should i`, `tell me about`, `walk me through`.
4. **Escape prefixes** — start a prompt with `?`, `/raw`, or `/claude` to
   force it through to the model this once.
5. **Global opt-out** — set `intercept_user_prompts: false` in
   `~/.config/token-ninja/config.yaml`.

Install control:

- `ninja setup --no-hook` — skip just the prompt hook (MCP still registered).
- `ninja setup --no-mcp` — skip just MCP (hook still installed).
- `ninja uninstall` — removes both, plus any shell-rc shims, plus any
  legacy `PreToolUse` Bash entry left by older versions.

**You don't need to configure this manually.** `ninja setup` (the postinstall
hook) merges an entry like the one below into:

- `~/.claude.json` (Claude Code)
- `~/.cursor/mcp.json` (Cursor)
- `~/Library/Application Support/Claude/claude_desktop_config.json` (Claude
  Desktop, macOS — Windows and Linux paths are handled too)

```jsonc
{
  "mcpServers": {
    "token-ninja": {
      "command": "ninja",
      "args": ["mcp"]
    }
  }
}
```

Existing entries are preserved; each file is backed up once
(`*.token-ninja.bak`) before the first modification. To opt out:
`ninja setup --no-mcp`. To remove just the MCP entries: `ninja uninstall`.

If you still want to do it yourself — e.g. a project-local `.mcp.json` or an
MCP client we don't know about — the manual command is:

```bash
ninja mcp    # stdio server exposing maybe_execute_locally
```

Each call the model makes looks like:

```jsonc
// handled locally
{ "handled": true, "stdout": "…", "stderr": "…", "exit_code": 0,
  "rule_id": "git-status", "tokens_saved_estimate": 512 }

// AI should handle it
{ "handled": false, "reason": "no_match" }
```

## Configuration

You don't need to touch this to get started — the defaults work out of the
box. If you want to tune things:

`~/.config/token-ninja/config.yaml`

```yaml
custom_rules_dir: ~/.config/token-ninja/rules  # where your own rules live
stats:
  enabled: true
  show_savings_on_exit: true                   # "⚡ handled by token-ninja" line
  verbose: false
```

Environment variables:

| Variable                          | Effect                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| `TOKEN_NINJA_SKIP_POSTINSTALL=1`  | Skip the automatic setup on `npm i -g`.                      |
| `CLAUDE_CONFIG_PATH=<path>`       | Override the Claude Code config path used by `ninja setup`.  |
| `XDG_CONFIG_HOME`                 | Honored for the token-ninja config dir and Claude Desktop on Linux. |

## Safety model

Every input is split into pipeline segments and each segment is tested against
a hard deny-list (see [`src/safety/denylist.ts`](src/safety/denylist.ts)).

What we block:

- `rm -rf` on any system path
- privilege escalation (`sudo`, `doas`)
- remote-code-execution pipes (`curl | sh`, `wget | bash`, `curl | python`)
- disk destroyers (`dd if=`, `mkfs`, `> /dev/sd*`)
- git footguns (`push --force` — but not `--force-with-lease`; `reset --hard`)
- SQL footguns (`DROP TABLE`, `DELETE` / `UPDATE` without `WHERE`)
- container / cluster footguns (`docker system prune -af`, `kubectl delete`
  without `--dry-run`)
- **evasion tricks**: homoglyph lookalikes (`ѕudo` with Cyrillic `ѕ`), NFKC
  normalization attacks, chained `&& / ; / |`, quoted / back-ticked
  substitution, base64 decode piped to a shell

Deny-listed inputs **never execute locally**. They fall back to the AI, where a
human can review the explanation before anything runs.

## Commands

You almost never need these — setup is automatic. Kept for diagnostics and
power users.

```
ninja setup [--dry-run] [--no-mcp] [--tool …]
                              auto-register token-ninja with every AI client
                              it can detect (the postinstall default)
ninja uninstall               undo setup; remove MCP entries from client configs
ninja mcp                     run the stdio MCP server (what the AI tool calls)
ninja stats [--json] [--reset]
                              see tokens saved, top rules, hit rate
ninja rules list [--domain …] [--json]
ninja rules test <input…>     dry-run the classifier against an input
```

## Benchmarks

`token-ninja` is a shell-adjacent tool — correctness and safety are
non-negotiable. The test suite is the safety net.

| Metric                          | Value                              |
| ------------------------------- | ---------------------------------- |
| Test files                      | **17**                             |
| Tests                           | **234** (all passing)              |
| Line coverage                   | **92.2%** &nbsp;(threshold: 85%)   |
| Branch coverage                 | **84.3%** &nbsp;(threshold: 80%)   |
| Function coverage               | **95.2%** &nbsp;(threshold: 95%)   |
| Statement coverage              | **92.2%** &nbsp;(threshold: 85%)   |
| Real-command fixture hit-rate   | **100%** on 657 commands (floor: 85%) |
| `classify()` benchmark          | **~19 µs/call** (10 k in < 800 ms) |
| `validate()` benchmark          | **~10 µs/call**  (10 k in < 100 ms) |

Coverage is enforced by `vitest` + `@vitest/coverage-v8` against
`src/router/**`, `src/safety/**`, and `src/rules/**`.

CI gates (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

- `lint` — ESLint flat config, typed rules
- `typecheck` — `tsc --noEmit`
- `build` — emits `dist/`, copies YAML rules, runs `npm pack --dry-run`
- `test` — Node 20 & 22 on `ubuntu-latest`, plus Node 20 on `macos-latest`
- `coverage` — uploaded as a workflow artifact

Benchmark assertions scale automatically on CI (`BENCH_FACTOR` auto-detected);
run `BENCH_FACTOR=1 npm test` locally for strict regression numbers, or set
`SKIP_BENCH=1` to treat benchmarks as informational.

## Development

```bash
git clone https://github.com/oanhduong/token-ninja
cd token-ninja
npm install

npm run lint             # eslint flat config
npm run typecheck        # tsc --noEmit
npm run build            # tsc + copy YAML rules to dist/
npm test                 # vitest run, 218 tests
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

## FAQ

**What does the postinstall hook actually change on my machine?**
It merges a single `token-ninja` entry into each AI client's MCP config
file — `~/.claude.json`, `~/.cursor/mcp.json`, and Claude Desktop's
OS-specific config. Nothing else is touched. Every file it writes is backed
up once (`*.token-ninja.bak`) before the first modification, and every
unrelated key is preserved. Run `ninja uninstall` to remove it, or set
`TOKEN_NINJA_SKIP_POSTINSTALL=1` at install time to skip the hook entirely.

**Does it work if I don't use Claude Code / Cursor / Claude Desktop?**
Yes — any MCP-capable client works. Point its server config at
`ninja mcp`. Non-MCP tools can still use token-ninja as a library or via
the `maybe_execute_locally` stdio protocol directly.

**What happens if a rule misclassifies my command?**
Nothing dangerous: safety is checked twice, and any resolved command that
doesn't match its declared safety tier is blocked — the agent is told
"handle this yourself" and takes over as if token-ninja weren't there.
If the match itself is wrong (e.g. prints the wrong thing), disable that
rule by shadowing its id in a file under `~/.config/token-ninja/rules/`.

**How is "tokens saved" calculated?**
Each rule carries a `tokens_saved_estimate`, or we estimate from input
length + captured output + a 400-token system-prompt overhead. See
[`src/telemetry/stats.ts`](src/telemetry/stats.ts).

**Does it work on Windows?**
Yes. The router and MCP server run anywhere Node 20+ runs; the auto-setup
handles the Windows Claude Desktop config path (`%APPDATA%\Claude\…`) out
of the box.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New rules are always welcome — the
fastest way to help is to browse
[`tests/fixtures/real-commands.txt`](tests/fixtures/real-commands.txt) for
commands that currently miss and add a rule covering them.

1. Pick the narrowest match type (`exact` > `prefix` > `regex` > `nl`).
2. Pick the right safety tier (`read-only` < `write-confined` < `write-network`
   < `blocked`).
3. Add at least one fixture line to `tests/fixtures/real-commands.txt`.
4. `npm test` — the coverage suite enforces a ≥ 85 % hit rate on fixtures.

Security issues: see [SECURITY.md](SECURITY.md). Community norms:
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © token-ninja contributors.

---

<div align="center">

If token-ninja saved you tokens today, consider dropping a
[star on GitHub](https://github.com/oanhduong/token-ninja) —
it's how the next person finds us.

</div>
