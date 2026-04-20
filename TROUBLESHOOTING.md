# Troubleshooting

If something looks off, **start with `ninja doctor`** — it checks the config,
rule count, shell shim, MCP entries, Claude hook, and stats file, and prints
a hint for each failure. Most issues below are surfaced there before you ever
hit this document.

```bash
ninja doctor           # human-readable health report
ninja doctor --json    # machine-readable; exit 1 if something is wrong
```

---

## 1. "Ninja saved 0 tokens" / hook never fires

Likely causes:

- **Stale shell session.** The shim is only picked up by new shells. Open a
  new terminal, or `source ~/.bashrc` / `~/.zshrc` / `~/.config/fish/config.fish`.
- **Hook pointing at a different install.** `ninja doctor` reports this as
  a `claude hook` **warn** with "points at a different token-ninja install".
  Fix: `ninja setup` rewrites the hook to the current install's path.
- **Claude Code didn't reload `~/.claude/settings.json`.** Close and re-open
  the app.
- **You disabled interception.** Check
  `~/.config/token-ninja/config.yaml` for `intercept_user_prompts: false`.

Verify end-to-end:

```bash
ninja route --strict "git status"
# expect: {"handled":true,"rule_id":"git-status", ...}
```

If that returns `handled:true`, the router is healthy and the issue is with
how Claude Code is invoking the hook (settings path, permissions, Node not
on PATH in the UI process, etc).

---

## 2. A command I expected to match doesn't

```bash
ninja rules test "your exact prompt here"
# prints: matched rule, domain, safety tier, and the resolved command —
# or: no rule matched
```

If nothing matches:

- It may be intentional (conversational prompt, too loose to match safely).
- The strict hook deliberately skips `regex` and `nl` hits so conversational
  prompts don't get hijacked. Route via `ninja` (non-strict) to test NL.
- Add a rule in `~/.config/token-ninja/rules/*.yaml` and re-test (user rules
  override built-ins by id).

If the *wrong* rule matches:

- The first confident match wins. Look at `matched via`. If it's `nl`, narrow
  your prompt; if it's `prefix`, your input likely shares the prefix with a
  wider rule.
- To shadow a built-in, redefine a rule with the same `id` in your user rules.

---

## 3. Stats file doesn't update

- Stats are written to `~/.config/token-ninja/stats.json`. Check:
  ```bash
  ls -la ~/.config/token-ninja/stats.json
  cat ~/.config/token-ninja/stats.json | head -20
  ```
- The `ninja` binary in your shell shim writes there, but a separately
  installed copy of ninja — the one from Claude Code hook, for instance —
  writes to whatever `configDir()` it sees. If the hook command is `node
  /absolute/path/to/hook.cjs`, its child `ninja route` call respects
  `XDG_CONFIG_HOME` from the Claude Code process.
- Reset corrupted stats: `ninja stats --reset`.

---

## 4. MCP: agent says "token-ninja" is not available

- `ninja doctor` will tell you which clients have token-ninja registered.
- If missing, `ninja setup` auto-registers for Claude Code, Cursor, Gemini
  CLI, and Claude Desktop. Re-run after installing a new MCP client.
- Manual check (JSON config files):
  ```bash
  jq '.mcpServers."token-ninja"' ~/.claude.json
  jq '.mcpServers."token-ninja"' ~/.cursor/mcp.json
  ```
- The MCP server is invoked as `ninja mcp`. Make sure `ninja` is on the PATH
  of the process that launches MCP servers — IDE GUIs often have a different
  PATH than your terminal.

---

## 5. "duplicate rule id ..." warning on load

The loader warns once per duplicate. If the duplicate is in your own rules,
change one of the ids. If both are built-ins, that's a bug — please open an
issue with the rule ids.

---

## 6. Safety: a safe command is being blocked

- `ninja rules test "your command"` does NOT run safety. Use:
  ```bash
  ninja --dry-run "your command"
  ```
  If it says "safety block", the deny-list matched.
- Common false positives: SQL `DELETE FROM x` without `WHERE`, inputs that
  contain Cyrillic lookalikes (we strip them before matching), base64
  substrings that look like pipe-to-shell.
- If you're sure it's safe, bypass for one call with your AI tool (`? git
  reset --hard` or `/claude …`) to let the model handle it. Don't loosen
  the deny-list to fix a single case — open an issue instead.

---

## 7. `ninja setup` wrote to the wrong rc file

- Set `TOKEN_NINJA_RC_FILE=/path/to/rc`  before running `ninja setup`.
- `ninja uninstall` is the clean undo. It only removes the managed block
  delimited by `# >>> token-ninja >>>` / `# <<< token-ninja <<<`.
- A one-time `.token-ninja.bak` exists next to every file we touched —
  restore from there if you want to revert entirely.

---

## 8. Postinstall did nothing on `npm install -g`

The postinstall is intentionally conservative — it skips:

- any install where `npm_config_global` isn't `"true"`
- any `CI=true` or `NODE_ENV=test` environment
- `TOKEN_NINJA_SKIP_POSTINSTALL=1`

Run `ninja setup` manually. Pass `TOKEN_NINJA_POSTINSTALL_DEBUG=1` on the
install command to see why it skipped.

---

## 9. Windows quirks

- Paths and rc files assume a POSIX shell. On Windows, use WSL or Git Bash.
- `ninja mcp` works natively on Windows; Claude Desktop config path is
  `%APPDATA%\Claude\claude_desktop_config.json`.
- If you see `PATHEXT` issues, verify `node.exe` and `ninja.cmd` are on the
  same PATH the MCP-hosting app sees.

---

## 10. Something else

- Open an issue: <https://github.com/oanhduong/token-ninja/issues>. Include
  the output of `ninja doctor --json`, your platform, and Node version.
- Security-relevant bugs (deny-list bypass, command injection) should go
  through the private path in [SECURITY.md](SECURITY.md) instead.
