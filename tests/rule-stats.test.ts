import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const script = resolve(root, "scripts", "rule-stats.mjs");

describe("scripts/rule-stats.mjs", () => {
  it("--json emits a payload with file/rule/domain totals", () => {
    const out = execFileSync("node", [script, "--json"], { encoding: "utf8" });
    const parsed = JSON.parse(out);
    expect(parsed.files).toBeGreaterThan(0);
    expect(parsed.rules).toBeGreaterThan(400);
    expect(parsed.domains).toBeGreaterThan(10);
    expect(typeof parsed.by).toBe("object");
  });

  it("--check passes when docs match the built-in count (run after --sync)", () => {
    // Keep docs in sync first so the assertion is about the script's logic,
    // not whether a contributor forgot to sync.
    execFileSync("node", [script, "--sync"], { encoding: "utf8" });
    // Should not throw when docs are in sync.
    execFileSync("node", [script, "--check"], { encoding: "utf8" });
  });

  it("--sync is idempotent: running twice produces no further changes", async () => {
    const readmePath = resolve(root, "README.md");
    execFileSync("node", [script, "--sync"], { encoding: "utf8" });
    const first = await readFile(readmePath, "utf8");
    execFileSync("node", [script, "--sync"], { encoding: "utf8" });
    const second = await readFile(readmePath, "utf8");
    expect(second).toBe(first);
  });
});
