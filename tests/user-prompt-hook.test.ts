import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(HERE, "..", "hooks", "claude-code-user-prompt.cjs");

interface RunOpts {
  extraEnv?: NodeJS.ProcessEnv;
  xdg?: string;
}

function runHook(input: unknown, pathDir: string, opts: RunOpts = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${pathDir}:${process.env.PATH ?? ""}`,
    ...opts.extraEnv,
  };
  if (opts.xdg !== undefined) env.XDG_CONFIG_HOME = opts.xdg;
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    env,
    encoding: "utf8",
    timeout: 15000,
  });
}

describe("Claude Code UserPromptSubmit hook", () => {
  let dir = "";
  let xdg = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tn-ups-hook-"));
    xdg = await mkdtemp(join(tmpdir(), "tn-ups-xdg-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(xdg, { recursive: true, force: true });
  });

  async function writeFakeNinja(response: unknown): Promise<string> {
    const script = join(dir, "ninja");
    await writeFile(
      script,
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(response))} + "\\n");\n`,
      "utf8"
    );
    await chmod(script, 0o755);
    return script;
  }

  it("short-circuits the model with decision=block when ninja handles the prompt", async () => {
    await writeFakeNinja({
      handled: true,
      stdout: "On branch main\n",
      stderr: "",
      exit_code: 0,
      rule_id: "git-status",
      tokens_saved_estimate: 512,
      matched_via: "exact",
    });
    const r = runHook({ prompt: "git status" }, dir, { xdg });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toMatch(/token-ninja handled locally/);
    expect(parsed.reason).toMatch(/git-status/);
    expect(parsed.reason).toMatch(/512/);
    expect(parsed.reason).toMatch(/On branch main/);
  });

  it("passes through when ninja reports handled=false", async () => {
    await writeFakeNinja({ handled: false, reason: "no_match" });
    const r = runHook({ prompt: "something unmatchable" }, dir, { xdg });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("passes through when ninja reports low_confidence (nl/regex rejected under --strict)", async () => {
    await writeFakeNinja({ handled: false, reason: "low_confidence", detail: "nl" });
    const r = runHook({ prompt: "what branch am I on?" }, dir, { xdg });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("safeguard 1: length cap — prompts over 80 chars skip classification", async () => {
    await writeFakeNinja({
      handled: true,
      stdout: "bad",
      exit_code: 0,
      rule_id: "x",
      tokens_saved_estimate: 1,
    });
    const longPrompt = "git status " + "blah ".repeat(40);
    const r = runHook({ prompt: longPrompt }, dir, { xdg });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("safeguard 3: conversational keyword blocklist", async () => {
    await writeFakeNinja({
      handled: true,
      stdout: "bad",
      exit_code: 0,
      rule_id: "x",
      tokens_saved_estimate: 1,
    });
    const r = runHook({ prompt: "explain git status to me" }, dir, { xdg });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("safeguard 4: escape prefix (? / /raw / /claude) opts out per-prompt", async () => {
    await writeFakeNinja({
      handled: true,
      stdout: "bad",
      exit_code: 0,
      rule_id: "x",
      tokens_saved_estimate: 1,
    });
    for (const prefix of ["? ", "/raw ", "/claude "]) {
      const r = runHook({ prompt: `${prefix}git status` }, dir, { xdg });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
    }
  });

  it("safeguard 5: intercept_user_prompts:false in config disables interception globally", async () => {
    await writeFakeNinja({
      handled: true,
      stdout: "bad",
      exit_code: 0,
      rule_id: "x",
      tokens_saved_estimate: 1,
    });
    // Write config.yaml under our fake XDG_CONFIG_HOME.
    await writeFile(
      join(xdg, "token-ninja", "config.yaml"),
      "intercept_user_prompts: false\n",
      { flag: "w" }
    ).catch(async () => {
      // parent dir may not exist yet
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(xdg, "token-ninja"), { recursive: true });
      await writeFile(
        join(xdg, "token-ninja", "config.yaml"),
        "intercept_user_prompts: false\n"
      );
    });
    const r = runHook({ prompt: "git status" }, dir, { xdg });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("fails open when ninja isn't on PATH", async () => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ prompt: "git status" }),
      env: { ...process.env, PATH: dir, XDG_CONFIG_HOME: xdg },
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("fails open when stdin isn't valid JSON", async () => {
    await writeFakeNinja({ handled: true, stdout: "x", exit_code: 0, rule_id: "x", tokens_saved_estimate: 1 });
    const r = spawnSync(process.execPath, [HOOK], {
      input: "this is not json",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, XDG_CONFIG_HOME: xdg },
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("passes through when the prompt is empty", async () => {
    await writeFakeNinja({ handled: true, stdout: "x", exit_code: 0, rule_id: "x", tokens_saved_estimate: 1 });
    const r = runHook({ prompt: "   " }, dir, { xdg });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
