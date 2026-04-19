import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRouter } from "../src/router/index.js";

let stdout = "";
let stderr = "";
let origWrite: typeof process.stdout.write;
let origErrWrite: typeof process.stderr.write;
let origExit: typeof process.exit;

beforeEach(() => {
  stdout = "";
  stderr = "";
  origWrite = process.stdout.write;
  origErrWrite = process.stderr.write;
  origExit = process.exit;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = origWrite;
  process.stderr.write = origErrWrite;
  process.exit = origExit;
});

describe("runRouter", () => {
  it("dry-run prints matched rule and returns 0", async () => {
    const code = await runRouter("git status", { dryRun: true });
    expect(code).toBe(0);
    expect(stdout).toContain("[dry-run]");
    expect(stdout).toContain("git-status");
  });

  it("unmatched input with --no-fallback returns 2", async () => {
    const code = await runRouter("xyzzy-unknown-command arg", { fallback: false });
    expect(code).toBe(2);
  });

  it("safety-blocked input with --no-fallback returns 2", async () => {
    const code = await runRouter("rm -rf /", { fallback: false });
    expect(code).toBe(2);
  });

  it("JSON mode emits handled=false for unmatched+no-fallback", async () => {
    await runRouter("xyzzy-unknown", { fallback: false, json: true });
    const line = stdout.split("\n").find((l) => l.includes("handled"));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.handled).toBe(false);
    expect(obj.reason).toBe("no_match");
  });

  it("JSON mode reports safety_block reason", async () => {
    await runRouter("rm -rf /", { fallback: false, json: true });
    const line = stdout.split("\n").find((l) => l.includes("handled"));
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!);
    expect(obj.handled).toBe(false);
    expect(obj.reason).toBe("safety_block");
  });

  it("executes a safe read-only command", async () => {
    const code = await runRouter("pwd", { fallback: false });
    expect(code).toBe(0);
  });

  it("verbose flag enables debug logging", async () => {
    // verbose sets logger state but doesn't throw; exercise the path
    const code = await runRouter("git status", { verbose: true, dryRun: true });
    expect(code).toBe(0);
  });

  it("prints a one-line savings hint on stderr after a local hit", async () => {
    const code = await runRouter("pwd", { fallback: false });
    expect(code).toBe(0);
    expect(stderr).toMatch(/ninja.*saved ~\d[\d,]* tokens/);
  });

  it("suppresses the savings hint in JSON mode", async () => {
    const code = await runRouter("pwd", { fallback: false, json: true });
    expect(code).toBe(0);
    expect(stderr).not.toMatch(/saved ~/);
  });
});
