import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listRules, testRule } from "../src/rules/loader.js";

let stdout = "";
let origWrite: typeof process.stdout.write;
let origExit: typeof process.exit;

beforeEach(() => {
  stdout = "";
  origWrite = process.stdout.write;
  origExit = process.exit;
  process.stdout.write = ((c: string | Uint8Array) => {
    stdout += typeof c === "string" ? c : Buffer.from(c).toString();
    return true;
  }) as typeof process.stdout.write;
  process.exit = ((_code?: number): never => {
    throw new Error("__exit__");
  }) as typeof process.exit;
});

afterEach(() => {
  process.stdout.write = origWrite;
  process.exit = origExit;
});

describe("rules commands", () => {
  it("listRules --json emits valid JSON array", async () => {
    await listRules({ json: true });
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(100);
  });

  it("listRules filters by domain", async () => {
    await listRules({ domain: "git", json: true });
    const parsed = JSON.parse(stdout) as Array<{ domain: string }>;
    expect(parsed.every((r) => r.domain === "git")).toBe(true);
  });

  it("listRules text output groups by domain", async () => {
    await listRules({});
    expect(stdout).toContain("git");
    expect(stdout).toContain("total:");
  });

  it("testRule prints the matched rule", async () => {
    await testRule("git status");
    expect(stdout).toContain("matched rule");
    expect(stdout).toContain("git-status");
  });

  it("testRule exits non-zero when no rule matches", async () => {
    await expect(testRule("xyzzy-unknown-command")).rejects.toThrow("__exit__");
    expect(stdout).toContain("no rule matched");
  });
});
