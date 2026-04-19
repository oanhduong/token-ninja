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
# One-shot invocations (shell wrapper). Type these at your OS terminal:
you@host:~/app$ claude -p "git status"
On branch main
nothing to commit, working tree clean
ninja saved ~512 tokens (git-status)

you@host:~/app$ claude -p "what's using port 3000"
COMMAND  PID  USER   FD   TYPE  DEVICE  SIZE/OFF NODE NAME
node    4812  alice  21u  IPv6  154321       0t0 TCP  *:3000 (LISTEN)
ninja saved ~438 tokens (port-usage)

you@host:~/app$ claude -p "explain this stack trace: …"
# not a deterministic command — passes straight through to real claude
```

For interactive sessions (`claude`, `cursor-agent`, etc. without args), register
token-ninja as an **MCP server** instead — see [MCP integration](#mcp-integration).
The agent then consults the router before every shell call, inside the same
REPL you already use.

No prefix. No mental overhead. Keep calling `claude`, `codex`, `cursor`, `aider`,
`gemini`, `continue` — token-ninja quietly handles the boring stuff and gets out
of the way for everything else.

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

The classifier runs in **~37 µs**. The safety validator runs in **~4 µs**. Neither
will ever be the slow part of your day.

## Install

```bash
npm install -g token-ninja
```

That's it. A postinstall hook runs `ninja setup`, which:

1. detects your shell (`bash` / `zsh` / `fish`),
2. detects any of `claude`, `codex`, `cursor-agent`, `aider`, `gemini`,
   `continue` on your `PATH`,
3. appends a small managed block to your rc file so one-shot calls to those
   tools route through `ninja` first,
4. **registers `ninja mcp` as an MCP server** in Claude Code
   (`~/.claude.json`), Cursor (`~/.cursor/mcp.json`), and Claude Desktop, so
   **interactive** agent sessions also benefit without any manual config,
5. backs up every file it touches once (`*.token-ninja.bak`) before the first
   write, and skips targets where the config is malformed,
6. writes a default config to `~/.config/token-ninja/config.yaml`.

**Open a new terminal and keep using your AI tool as before.** Matched commands
run locally and print a one-line hint like `ninja saved ~512 tokens (git-status)`.
Everything else falls through to the AI, unchanged.

> **Requirements:** Node ≥ 20.
>
> **Opt out of the postinstall hook:**
> `TOKEN_NINJA_SKIP_POSTINSTALL=1 npm install -g token-ninja`
>
> **Opt out of MCP auto-registration only** (keep the shell shim):
> `ninja setup --no-mcp`
>
> **Roll back any time:** `ninja uninstall` — strips the managed block and
> removes the MCP entry from each client config it wrote to.

## Quickstart

```bash
# One-shot mode — type these at your OS terminal (bash/zsh/fish), not inside
# Claude Code's REPL. token-ninja's shell shim wraps the `claude` binary on
# your PATH, inspects the argument, and runs matched commands locally:
claude -p "git status"             # 0 tokens
claude -p "build the project"      # 0 tokens (reads package.json / Cargo.toml / …)
claude -p "what branch am I on"    # 0 tokens (natural language → git branch --show-current)
claude -p "rm -rf /"               # blocked — falls back to real claude for human review
claude -p "explain this error: …"  # no match — passes straight through

# Or invoke ninja directly — same router:
ninja "show recent commits"

# See the damage report
ninja stats
```

> **Interactive Claude Code sessions** (running `claude` with no args and typing
> commands at the REPL) bypass the shell shim by design — once the REPL owns
> your terminal, the shim can't see what you type. `ninja setup` handles that
> for you automatically by registering `ninja mcp` as an MCP server in
> `~/.claude.json`, `~/.cursor/mcp.json`, and Claude Desktop's config.
> Open a fresh REPL after install and it's already wired up. See
> [MCP integration](#mcp-integration) for the details.

Re-run auto-setup any time: `ninja setup` · Preview without writing:
`ninja setup --dry-run` · Scope to specific tools: `ninja setup --tool claude`.

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
- **Fast**: ~37 µs per classification, ~4 µs per safety check (warm JIT).
- **Safe by construction**: layered deny-list blocks `rm -rf /`, `sudo`,
  `git push --force`, `DROP TABLE`, `curl | sh`, `dd if=`, `mkfs`, … including
  homoglyph, NFKC, chained, and base64-decoded evasion.
- **Zero-setup**: `npm install -g` is literally the whole install. A
  postinstall hook wires up your shell; `ninja uninstall` reverses it.
- **Transparent UX**: keep calling `claude`, `codex`, etc. The only thing you
  notice is a green one-liner: `ninja saved ~512 tokens (git-status)`.
- **Pluggable**: drop a `.yaml` into `~/.config/token-ninja/rules/` to add
  your own patterns. User rules override builtins by id.
- **MCP-native**: exposes `maybe_execute_locally` over stdio so AI agents can
  consult the router *before* generating tokens.
- **Telemetry built in**: `ninja stats` shows hit rate, top rules, and an
  estimate of the tokens you've saved to date.
- **Dry-run friendly**: `ninja --dry-run "…"` prints what would run;
  `ninja rules test "…"` shows which rule would fire.

## Supported AI tools

| Tool            | Adapter id  | Binary detected on PATH |
| --------------- | ----------- | ----------------------- |
| Claude Code     | `claude`    | `claude`                |
| OpenAI Codex    | `codex`     | `codex`                 |
| Cursor          | `cursor`    | `cursor-agent`          |
| Aider           | `aider`     | `aider`                 |
| Gemini CLI      | `gemini`    | `gemini`                |
| Continue        | `continue`  | `continue`              |
| *Anything else* | `generic`   | via `fallback_command`  |

Installing a new AI tool later? Just run `ninja setup` — it's idempotent.

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

Interactive agents (Claude Code REPL, Cursor, Claude Desktop, Continue, …)
don't go through the shell shim — they call shell commands *from inside* the
agent. Registering `token-ninja` as an MCP server lets the agent consult the
router on every command **before** it burns tokens.

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

`~/.config/token-ninja/config.yaml`:

```yaml
default_ai_tool: claude                     # fallback AI CLI
fallback_command: "{{tool}} {{input}}"      # how we invoke it
custom_rules_dir: ~/.config/token-ninja/rules
stats:
  enabled: true
  show_savings_on_exit: true                # the green "ninja saved ~N tokens" line
  verbose: false
```

Environment variables:

| Variable                          | Effect                                                 |
| --------------------------------- | ------------------------------------------------------ |
| `TOKEN_NINJA_SKIP_POSTINSTALL=1`  | Skip the automatic rc-file install on `npm i -g`.      |
| `TOKEN_NINJA_RC_FILE=<path>`      | Override the rc file path (testing, esoteric shells).  |
| `XDG_CONFIG_HOME`                 | Honored for both config dir and fish config location.  |

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

```
ninja <input…>                route a command (the default)
ninja setup [--dry-run] [--shell …] [--tool …]
                              auto-install shim into your rc file
ninja uninstall               remove the managed block from your rc file
ninja init                    alias for `setup` (kept for compatibility)
ninja mcp                     start MCP stdio server (maybe_execute_locally)
ninja stats [--json] [--reset]
                              cumulative savings
ninja shim <tool> [--shell …]
                              print a shell function that wraps one AI tool
ninja rules list [--domain …] [--json]
ninja rules test <input…>     dry-run the classifier

Global options:
  -v, --verbose               verbose stderr logging
  --dry-run                   print the resolved command, don't execute
  --ai <tool>                 override fallback tool
  --no-fallback               fail non-zero on a miss instead of calling AI
  --json                      machine-readable output
```

## Benchmarks

`token-ninja` is a shell-adjacent tool — correctness and safety are
non-negotiable. The test suite is the safety net.

| Metric                          | Value                              |
| ------------------------------- | ---------------------------------- |
| Test files                      | **16**                             |
| Tests                           | **218** (all passing)              |
| Line coverage                   | **91.2%** &nbsp;(threshold: 85%)   |
| Branch coverage                 | **83.2%** &nbsp;(threshold: 80%)   |
| Function coverage               | **95.2%** &nbsp;(threshold: 95%)   |
| Statement coverage              | **91.2%** &nbsp;(threshold: 85%)   |
| Real-command fixture hit-rate   | **≥ 85%** enforced                 |
| `classify()` benchmark          | **~37 µs/call** (10 k in < 800 ms) |
| `validate()` benchmark          | **~4 µs/call**  (10 k in < 100 ms) |

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

**Does it modify my `.zshrc` without asking?**
The postinstall hook runs `ninja setup` after a **global** install
(`npm install -g`). It writes a single well-marked block (`# >>> token-ninja >>>`
… `# <<< token-ninja <<<`) and backs up the original once. Run
`ninja uninstall` to remove it, or set `TOKEN_NINJA_SKIP_POSTINSTALL=1` at
install time to skip the hook entirely.

**What happens if a rule misclassifies my command?**
Nothing dangerous: safety is checked twice, and any resolved command that
doesn't match its declared safety tier is blocked and falls back to the AI.
If the match itself is wrong (e.g. prints the wrong thing), disable that rule
by shadowing its id in a file under `~/.config/token-ninja/rules/`.

**How is "tokens saved" calculated?**
Each rule carries a `tokens_saved_estimate`, or we estimate from input length +
captured output + a 400-token system-prompt overhead. See
[`src/telemetry/stats.ts`](src/telemetry/stats.ts).

**Can I use token-ninja without letting it modify my shell?**
Yes. `TOKEN_NINJA_SKIP_POSTINSTALL=1 npm i -g token-ninja` installs only the
`ninja` binary. Invoke it directly (`ninja "git status"`), or use it through
MCP (`ninja mcp`).

**Does it work on Windows?**
The router and MCP server run anywhere Node 20+ runs. Shell shim generation
targets `bash` / `zsh` / `fish`; PowerShell support is on the roadmap. In the
meantime, Windows users can invoke `ninja` directly or use the MCP server.

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
