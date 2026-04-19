#!/usr/bin/env node
/*
 * token-ninja — Claude Code PreToolUse hook for Bash.
 *
 * Claude Code sends us a JSON payload on stdin. For Bash calls, we ask the
 * `ninja` CLI whether it can handle the command locally. If yes, we block
 * Bash and return the output as the decision reason — Claude reads it and
 * answers the user without ever spending tokens on execution. If not, we
 * exit 0 and Bash proceeds as usual.
 *
 * Fail-open: any unexpected condition (ninja missing, parse failure, timeout)
 * exits 0. We never turn token-ninja into a single point of failure for the
 * user's shell.
 */

const { spawnSync } = require("node:child_process");

const HOOK_TIMEOUT_MS = 15000;

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
    // Safety net: if Claude never closes stdin for some reason, don't hang.
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

function buildReason(result) {
  const parts = [];
  const rule = result.rule_id || "local";
  const saved = Number(result.tokens_saved_estimate || 0);
  parts.push(
    `[token-ninja handled locally — rule:${rule}, saved ~${saved.toLocaleString("en-US")} tokens]`
  );
  parts.push(`exit_code: ${typeof result.exit_code === "number" ? result.exit_code : 0}`);
  if (result.stdout && result.stdout.length > 0) {
    parts.push("stdout:");
    parts.push(result.stdout.replace(/\n+$/, ""));
  }
  if (result.stderr && result.stderr.length > 0) {
    parts.push("stderr:");
    parts.push(result.stderr.replace(/\n+$/, ""));
  }
  parts.push(
    "The Bash call was intercepted; the command has already executed locally. Use this output to answer the user directly — do not re-run the command via Bash."
  );
  return parts.join("\n");
}

async function main() {
  const raw = await readStdin();
  const input = safeParse(raw);
  if (!input || input.tool_name !== "Bash") passthrough();

  const command =
    input && input.tool_input && typeof input.tool_input.command === "string"
      ? input.tool_input.command
      : "";
  if (!command.trim()) passthrough();

  const cwd = (input && input.cwd && typeof input.cwd === "string") ? input.cwd : process.cwd();

  let spawned;
  try {
    spawned = spawnSync("ninja", ["route", "--cwd", cwd, command], {
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

  process.stdout.write(
    JSON.stringify({ decision: "block", reason: buildReason(result) }) + "\n"
  );
  process.exit(2);
}

main().catch(() => process.exit(0));
