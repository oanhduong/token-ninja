import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { printStats, recordFallback, recordHit } from "../src/telemetry/stats.js";
import { invalidateConfigCache } from "../src/config/user-config.js";
import type { ExecResult } from "../src/router/executor.js";
import type { Rule } from "../src/rules/types.js";

const RULE: Rule = {
  id: "test-rule",
  domain: "test",
  match: { type: "exact", patterns: ["noop"] },
  action: { type: "shell", command: "true" },
  safety: "read-only",
};

const RESULT: ExecResult = {
  stdout: "hello",
  stderr: "",
  exitCode: 0,
  durationMs: 5,
  truncated: false,
  timedOut: false,
};

let home: string;
let ninjaDir: string;
let statsFile: string;
let origEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  origEnv = { ...process.env };
  home = await mkdtemp(join(tmpdir(), "ninja-stats-"));
  process.env.XDG_CONFIG_HOME = join(home, "config");
  ninjaDir = join(process.env.XDG_CONFIG_HOME, "token-ninja");
  statsFile = join(ninjaDir, "stats.json");
  await mkdir(ninjaDir, { recursive: true });
  invalidateConfigCache();
});

afterEach(async () => {
  process.env = origEnv;
  invalidateConfigCache();
  await rm(home, { recursive: true, force: true });
});

describe("stats — writes", () => {
  it("records a hit as valid JSON", async () => {
    await recordHit(RULE, "noop", RESULT);
    const parsed = JSON.parse(await readFile(statsFile, "utf8"));
    expect(parsed.version).toBe(1);
    expect(parsed.total_hits).toBe(1);
    expect(parsed.by_rule["test-rule"].count).toBe(1);
    expect(parsed.by_domain.test).toBe(1);
  });

  it("accumulates across calls", async () => {
    await recordHit(RULE, "noop", RESULT);
    await recordHit(RULE, "noop", RESULT);
    await recordFallback("no_match");
    const parsed = JSON.parse(await readFile(statsFile, "utf8"));
    expect(parsed.total_hits).toBe(2);
    expect(parsed.total_fallbacks).toBe(1);
    expect(parsed.fallback_reasons.no_match).toBe(1);
  });

  it("counts safety blocks separately", async () => {
    await recordFallback("safety_block");
    const parsed = JSON.parse(await readFile(statsFile, "utf8"));
    expect(parsed.total_safety_blocks).toBe(1);
  });

  it("leaves no temp files behind", async () => {
    await recordHit(RULE, "noop", RESULT);
    const entries = await readdir(ninjaDir);
    expect(entries.filter((e) => e.includes(".tmp"))).toEqual([]);
  });

  it("never leaves a partially-written file visible to a concurrent reader", async () => {
    // Concurrent writers race on read-modify-write, so the final count is not
    // deterministic — but every observer must see well-formed JSON, which is
    // what the temp-file + rename gives us.
    await Promise.all(Array.from({ length: 12 }, () => recordHit(RULE, "noop", RESULT)));
    const parsed = JSON.parse(await readFile(statsFile, "utf8"));
    expect(parsed.version).toBe(1);
    expect(parsed.total_hits).toBeGreaterThan(0);
  });
});

describe("stats — corrupt file recovery", () => {
  it("moves an unparseable stats file aside instead of silently erasing history", async () => {
    await writeFile(statsFile, "{ this is not json", "utf8");
    await recordHit(RULE, "noop", RESULT);

    const entries = await readdir(ninjaDir);
    const backups = entries.filter((e) => e.startsWith("stats.json.corrupt-"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(ninjaDir, backups[0]!), "utf8")).toBe("{ this is not json");

    // …and carries on with fresh counters rather than failing the command.
    const parsed = JSON.parse(await readFile(statsFile, "utf8"));
    expect(parsed.total_hits).toBe(1);
  });

  it("does not create a backup when the file is simply missing", async () => {
    await recordHit(RULE, "noop", RESULT);
    const entries = await readdir(ninjaDir);
    expect(entries.filter((e) => e.includes("corrupt"))).toEqual([]);
  });
});

describe("stats — enabled flag", () => {
  it("writes nothing when stats.enabled is false", async () => {
    await writeFile(join(ninjaDir, "config.yaml"), "stats:\n  enabled: false\n", "utf8");
    invalidateConfigCache();
    await recordHit(RULE, "noop", RESULT);
    await recordFallback("no_match");
    expect(existsSync(statsFile)).toBe(false);
  });

  it("writes when stats.enabled is true", async () => {
    await writeFile(join(ninjaDir, "config.yaml"), "stats:\n  enabled: true\n", "utf8");
    invalidateConfigCache();
    await recordHit(RULE, "noop", RESULT);
    expect(existsSync(statsFile)).toBe(true);
  });
});

describe("printStats", () => {
  function captureStdout(): { text: () => string; restore: () => void } {
    let out = "";
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    return { text: () => out, restore: () => { process.stdout.write = orig; } };
  }

  it("--json round-trips the stats file", async () => {
    await recordHit(RULE, "noop", RESULT);
    const cap = captureStdout();
    try {
      await printStats({ json: true });
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.text());
    expect(parsed.total_hits).toBe(1);
    expect(parsed.by_rule["test-rule"]).toBeTruthy();
  });

  it("renders a human summary with hit rate and top rules", async () => {
    await recordHit(RULE, "noop", RESULT);
    await recordFallback("no_match");
    const cap = captureStdout();
    try {
      await printStats({});
    } finally {
      cap.restore();
    }
    const out = cap.text();
    expect(out).toContain("local-execution stats");
    expect(out).toContain("total local hits");
    expect(out).toContain("test-rule");
    expect(out).toContain("50.0%");
    expect(out).toContain("fallback reasons");
  });

  it("handles an empty stats file without dividing by zero", async () => {
    const cap = captureStdout();
    try {
      await printStats({});
    } finally {
      cap.restore();
    }
    expect(cap.text()).toContain("0.0%");
  });

  it("--reset zeroes the counters", async () => {
    await recordHit(RULE, "noop", RESULT);
    const cap = captureStdout();
    try {
      await printStats({ reset: true });
    } finally {
      cap.restore();
    }
    expect(cap.text()).toContain("stats reset");
    const parsed = JSON.parse(await readFile(statsFile, "utf8"));
    expect(parsed.total_hits).toBe(0);
  });
});
