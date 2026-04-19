import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(HERE, "..", "hooks", "claude-code-bash.cjs");

function runHook(input: unknown, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 15000,
  });
}

describe("Claude Code Bash hook script", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tn-hook-script-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeFakeNinja(response: unknown): Promise<string> {
    const script = join(dir, "ninja");
    // The fake `ninja` ignores its args and prints the canned JSON.
    await writeFile(
      script,
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(response))} + "\\n");\n`,
      "utf8"
    );
    await chmod(script, 0o755);
    return script;
  }

  it("exits 0 when tool_name is not Bash", async () => {
    await writeFakeNinja({ handled: true, stdout: "nope", exit_code: 0, rule_id: "x", tokens_saved_estimate: 1 });
    const r = runHook(
      { tool_name: "Edit", tool_input: { command: "anything" } },
      { PATH: `${dir}:${process.env.PATH ?? ""}` }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("exits 0 when ninja reports handled=false", async () => {
    await writeFakeNinja({ handled: false, reason: "no_match" });
    const r = runHook(
      { tool_name: "Bash", tool_input: { command: "xyzzy" } },
      { PATH: `${dir}:${process.env.PATH ?? ""}` }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("blocks Bash and surfaces stdout/rule/tokens in both legacy and hookSpecificOutput fields when handled", async () => {
    await writeFakeNinja({
      handled: true,
      stdout: "On branch main\n",
      stderr: "",
      exit_code: 0,
      rule_id: "git-status",
      tokens_saved_estimate: 512,
      matched_via: "exact",
    });
    const r = runHook(
      { tool_name: "Bash", tool_input: { command: "git status" } },
      { PATH: `${dir}:${process.env.PATH ?? ""}` }
    );
    // Exit 0 with JSON-encoded deny so Claude Code renders the block as
    // "permission denied" rather than "error". Legacy `decision` kept as a
    // fallback for clients predating hookSpecificOutput.
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed.decision).toBe("block");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/git-status/);
    expect(parsed.reason).toMatch(/git-status/);
    expect(parsed.reason).toMatch(/On branch main/);
    expect(parsed.reason).toMatch(/512/);
  });

  it("fails open (exit 0) when ninja isn't on PATH", async () => {
    const r = runHook(
      { tool_name: "Bash", tool_input: { command: "git status" } },
      { PATH: dir } // dir has no `ninja` binary
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("fails open when stdin isn't valid JSON", async () => {
    await writeFakeNinja({ handled: true, stdout: "x", exit_code: 0, rule_id: "x", tokens_saved_estimate: 1 });
    const r = spawnSync(process.execPath, [HOOK], {
      input: "this is not json",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
