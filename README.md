# token-ninja

> Save tokens on commands that don't need AI.

`token-ninja` sits between you and your AI coding assistant (Claude Code, Codex,
Cursor, Aider, Gemini, Continue, …) and intercepts commands that are trivially
deterministic — `git status`, `npm install`, `docker ps`, `show recent commits`
— running them locally with zero LLM round-trips. Anything it doesn't confidently
recognize passes through to your AI tool, unchanged.

- **472+ built-in rules** across 29 tool domains (git, npm, pnpm, yarn, bun,
  cargo, go, docker, kubernetes, python, ruby, php, database, network, …)
- **Fast**: ~37µs per classification, ~4µs per safety check
- **Safe**: hard deny-list for destructive patterns (`rm -rf /`, `sudo`,
  `git push --force`, `DROP TABLE`, `curl | sh`, homoglyph / chained / encoded
  evasion) — blocked inputs always fall back to the AI rather than running
- **Pluggable**: drop a `.yaml` file in `~/.config/token-ninja/rules/` to
  add your own patterns
- **MCP-native**: exposes a `maybe_execute_locally` tool so AI agents can
  call the router directly before reaching for the LLM

## Install

```bash
npm install -g token-ninja
```

Node 20+ is required.

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

### Make it transparent

Install a shell function so every call to `claude …`, `codex …`, etc.
automatically routes through ninja first. Ninja handles the command locally
when it can, or falls back to the real binary when it can't.

```bash
# zsh/bash
ninja shim claude >> ~/.zshrc
source ~/.zshrc

# fish
ninja shim claude --shell fish >> ~/.config/fish/config.fish

# Now this is free for any known command, and only hits the LLM when needed:
claude "git status"
```

Available shims: `claude`, `codex`, `cursor-agent`, `aider`, `gemini`, `continue`.

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

### Match order

1. **Exact** — `git status`, `docker ps`, `npm test` (hash-indexed, O(1))
2. **Prefix** — longest match wins: `git add src/…`, `npm install -D vitest`
3. **Regex** — captures: `^git\s+checkout\s+(\S+)$`
4. **Natural language** — keyword groups: `["show", "recent", "commits"]` →
   `git log --oneline -20`

The first confident match wins. Safety is checked BEFORE classification AND
on the resolved command (defence-in-depth).

### Safety model

Every input is split into pipeline segments and each segment is tested against
a hard deny-list (see [`src/safety/denylist.ts`](src/safety/denylist.ts)). Matches
include: `rm -rf` on any system path, privilege escalation, `curl | sh`,
`dd if=`, `mkfs`, `git push --force` (but not `--force-with-lease`),
`git reset --hard`, `DROP TABLE`, `DELETE`/`UPDATE` without `WHERE`,
`docker system prune -af`, `kubectl delete`, homoglyph lookalikes, base64
decode piped to shell, and more. The validator normalizes to NFKC and strips
common Cyrillic/Greek homoglyphs before testing, so `ѕudo` (Cyrillic `ѕ`) is
rejected.

Deny-listed inputs never execute locally — they fall back to the AI, where
a human can review the explanation.

### Rule format

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

See `src/rules/builtin/*.yaml` for 472 production-grade examples.

**Match types:** `exact`, `prefix`, `regex`, `nl`
**Action types:** `shell`, `shell-detect` (choose based on repo markers),
`passthrough` (force AI fallback)
**Safety tiers:** `read-only`, `write-confined`, `write-network`, `blocked`

**Template variables:** `{{input}}`, `{{args}}`, `{{arg1}}` – `{{arg9}}`,
`{{message}}`, `{{branch}}`, `{{target}}`, `{{path}}`, `{{script}}`, `{{pkg}}`.

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

## MCP integration

```bash
ninja mcp            # stdio server exposing tool: maybe_execute_locally
```

Point your AI client (Claude Desktop, Cursor, etc.) at this command to let
the model consult the router before generating tokens. The tool returns
`{handled:true, stdout, stderr, exit_code, rule_id, tokens_saved_estimate}`
when a local rule matched, or `{handled:false, reason}` when the AI should
handle the request itself.

## Configuration

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

## Development

```bash
git clone https://github.com/token-ninja/token-ninja
cd token-ninja
npm install
npm test                 # 195+ tests
npm run test:coverage    # v8 coverage, thresholds enforced
npm run lint
npm run typecheck
npm run build
```

The test suite includes:
- classifier correctness (exact / prefix / regex / NL / template expansion)
- safety denies for known destructive patterns + evasion tricks (chaining,
  quoting, homoglyphs, base64)
- ≥85 % of a large real-command fixture must classify without falling back
- micro-benchmark asserting <40µs/classification

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New rules are always welcome — the
fastest way to help is to browse `tests/fixtures/real-commands.txt` for
commands that currently miss and add a rule covering them.

## License

MIT — see [LICENSE](LICENSE).
