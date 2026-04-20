#!/usr/bin/env node
/*
 * token-ninja — Claude Code UserPromptSubmit hook.
 *
 * Fires BEFORE the user's prompt becomes an API call to Anthropic. When a
 * prompt matches a high-confidence rule (exact or prefix), we execute it
 * locally and short-circuit the model — the prompt is never sent, the
 * response is never generated, zero tokens are consumed. The captured
 * output is rendered directly to the user via `decision: "block"` + reason.
 *
 * Safeguards against mis-interception:
 *   1. Length cap (prompts over 80 chars skip, likely conversational)
 *   2. Strict-mode routing (reject nl + regex matches)
 *   3. Conversational keyword blocklist (explain/why/how/…)
 *   4. Escape prefixes ("? git status" or "/raw git status" skip)
 *   5. Global opt-out via intercept_user_prompts=false in config.yaml
 *
 * Fail-open: anything unexpected exits 0, prompt flows to Claude as usual.
 */

const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");

const HOOK_TIMEOUT_MS = 15000;
const MAX_PROMPT_CHARS = 80;
const ESCAPE_PREFIXES = ["?", "/raw", "/claude"];
const CONVERSATIONAL_RE = /\b(explain|why|how|review|suggest|teach|help me|should i|walk me through|tell me about)\b/i;

function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(buf);
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    setTimeout(finish, HOOK_TIMEOUT_MS).unref();
  });
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function passthrough() {
  process.exit(0);
}

function configDir() {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "token-ninja");
}

/**
 * Minimal YAML lookup for `intercept_user_prompts: false`. We avoid loading
 * the `yaml` package from an arbitrary location so the hook stays
 * dependency-free. Any parse failure is treated as "use the default"
 * (enabled), which is fail-open for the user's expectation.
 */
function interceptEnabled() {
  try {
    const raw = readFileSync(join(configDir(), "config.yaml"), "utf8");
    const match = /^\s*intercept_user_prompts\s*:\s*(\S+)/m.exec(raw);
    if (!match) return true;
    const v = match[1].trim().toLowerCase().replace(/["',]$/g, "");
    return !(v === "false" || v === "no" || v === "0" || v === "off");
  } catch {
    return true;
  }
}

function stripEscape(prompt) {
  for (const p of ESCAPE_PREFIXES) {
    if (prompt === p) return null; // only the prefix → nothing to run
    if (prompt.startsWith(p + " ")) return prompt.slice(p.length + 1).trim();
  }
  return prompt;
}

function buildSuppressionText(result) {
  // Output-first layout: the captured stdout (with its original ANSI colors)
  // is the whole response the user sees, exactly as if they had typed the
  // command in their terminal. A single dimmed footer line at the very end
  // acknowledges ninja handled it and reports the token savings. Dim ANSI
  // (\x1b[2m) makes the footer recede without vanishing, matching the
  // "feels native" goal.
  const saved = Number(result.tokens_saved_estimate || 0).toLocaleString("en-US");
  const rule = result.rule_id || "local";
  const stdout = typeof result.stdout === "string" ? result.stdout.replace(/\n+$/, "") : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.replace(/\n+$/, "") : "";
  const code = typeof result.exit_code === "number" ? result.exit_code : 0;

  const lines = [];
  if (stdout.length > 0) lines.push(stdout);
  if (stderr.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(stderr);
  }
  if (code !== 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`(exit ${code})`);
  }
  const footer = `\x1b[2m⚡ ninja · saved ~${saved} tokens · ${rule}\x1b[22m`;
  if (lines.length > 0) lines.push("");
  lines.push(footer);
  return lines.join("\n");
}

async function main() {
  const raw = await readStdin();
  const input = safeParse(raw);
  if (!input) passthrough();

  const original =
    typeof input.prompt === "string"
      ? input.prompt
      : typeof input.user_prompt === "string"
        ? input.user_prompt
        : "";
  const trimmed = original.trim();
  if (!trimmed) passthrough();

  // Safeguard 4: escape prefixes opt the user out per-prompt.
  const afterEscape = stripEscape(trimmed);
  if (afterEscape === null || afterEscape !== trimmed) passthrough();

  // Safeguard 5: global opt-out.
  if (!interceptEnabled()) passthrough();

  // Safeguard 1: length cap.
  if (trimmed.length > MAX_PROMPT_CHARS) passthrough();

  // Safeguard 3: conversational keywords.
  if (CONVERSATIONAL_RE.test(trimmed)) passthrough();

  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();

  // Safeguard 2: strict routing (only exact/prefix).
  let spawned;
  try {
    spawned = spawnSync("ninja", ["route", "--strict", "--cwd", cwd, trimmed], {
      encoding: "utf8",
      timeout: HOOK_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    passthrough();
  }
  if (!spawned || spawned.error || spawned.status !== 0) passthrough();

  const stdout = (spawned.stdout || "").trim();
  if (!stdout) passthrough();

  const result = safeParse(stdout.split(/\r?\n/).pop());
  if (!result || result.handled !== true) passthrough();

  // Short-circuit: decision:"block" with the captured output as the reason.
  // Claude Code renders the reason directly to the user and skips the model.
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: buildSuppressionText(result),
    }) + "\n"
  );
  process.exit(0);
}

main().catch(() => process.exit(0));
