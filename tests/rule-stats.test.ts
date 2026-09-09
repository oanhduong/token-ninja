import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const script = resolve(root, "scripts", "rule-stats.mjs");

// Most cases pass --no-test-count: the test-count path shells out to
// `vitest list`, and spawning a nested vitest for every case makes this file
// the slowest in the suite for no extra signal. One case below covers it.
const FAST = ["--no-test-count"];

describe("scripts/rule-stats.mjs", () => {
  it("--json emits a payload with file/rule/domain totals", () => {
    const out = execFileSync("node", [script, "--json", ...FAST], { encoding: "utf8" });
    const parsed = JSON.parse(out);
    expect(parsed.files).toBeGreaterThan(0);
    expect(parsed.rules).toBeGreaterThan(400);
    expect(parsed.domains).toBeGreaterThan(10);
    expect(typeof parsed.by).toBe("object");
  });

  it("--check passes when docs match the built-in count (run after --sync)", () => {
    // Keep docs in sync first so the assertion is about the script's logic,
    // not whether a contributor forgot to sync.
    execFileSync("node", [script, "--sync", ...FAST], { encoding: "utf8" });
    // Should not throw when docs are in sync.
    execFileSync("node", [script, "--check", ...FAST], { encoding: "utf8" });
  });

  it("--sync is idempotent: running twice produces no further changes", async () => {
    const readmePath = resolve(root, "README.md");
    execFileSync("node", [script, "--sync", ...FAST], { encoding: "utf8" });
    const first = await readFile(readmePath, "utf8");
    execFileSync("node", [script, "--sync", ...FAST], { encoding: "utf8" });
    const second = await readFile(readmePath, "utf8");
    expect(second).toBe(first);
  });

  it("counts tests by collecting the suite, not by grepping for it(", () => {
    // `it.each` and loop-generated cases make a static count wrong: this repo
    // has ~285 literal `it(` calls and far more actual tests.
    const out = execFileSync("node", [script, "--json"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(out);
    expect(parsed.tests).toBeGreaterThan(300);
    expect(parsed.testFiles).toBeGreaterThan(20);
  }, 120_000);

  it("--no-test-count reports null counts instead of guessing", () => {
    const out = execFileSync("node", [script, "--json", ...FAST], { encoding: "utf8" });
    const parsed = JSON.parse(out);
    expect(parsed.tests).toBeNull();
    expect(parsed.testFiles).toBeNull();
    expect(parsed.rules).toBeGreaterThan(400);
  });
});
