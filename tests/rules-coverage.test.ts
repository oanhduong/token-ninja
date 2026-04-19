import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { loadRules } from "../src/rules/loader.js";
import { classify } from "../src/router/classifier.js";
import type { LoadedRules } from "../src/rules/types.js";
import { validate } from "../src/safety/validator.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "fixtures", "real-commands.txt");

let rules: LoadedRules;
const ctx = { cwd: process.cwd() };

beforeAll(async () => {
  rules = await loadRules();
});

describe("rule inventory", () => {
  it("loads at least 150 rules", () => {
    expect(rules.rules.length).toBeGreaterThanOrEqual(150);
  });

  it("every rule has a unique id", () => {
    const ids = new Set(rules.rules.map((r) => r.id));
    expect(ids.size).toBe(rules.rules.length);
  });

  it("every rule declares a safety tier", () => {
    for (const r of rules.rules) {
      expect(
        ["read-only", "write-confined", "write-network", "blocked"].includes(r.safety),
        `rule ${r.id} missing safety`
      ).toBe(true);
    }
  });

  it("exact patterns total at least 400", () => {
    let total = 0;
    for (const r of rules.rules) {
      if (r.match.type === "exact") total += r.match.patterns.length;
    }
    expect(total).toBeGreaterThanOrEqual(400);
  });

  it("covers every required domain", () => {
    const required = [
      "shell-basic", "shell-advanced", "filesystem", "text-processing",
      "process-mgmt", "network", "git", "github-cli", "npm", "yarn",
      "pnpm", "bun", "python", "java", "kotlin", "rust", "go", "ruby",
      "php", "docker", "kubernetes", "database", "build-tools",
      "test-runners", "linters", "editors", "system-info", "archive",
      "nl-mappings",
    ];
    for (const d of required) {
      expect(rules.byDomain.has(d), `domain missing: ${d}`).toBe(true);
    }
  });
});

describe("fixture coverage — real commands", () => {
  it("≥85% of fixture commands classify to a rule", async () => {
    const raw = await readFile(fixturePath, "utf8");
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    let hit = 0;
    const misses: string[] = [];
    for (const line of lines) {
      const safety = validate(line);
      if (!safety.allowed) {
        hit++; // safety block is a valid outcome (router falls back to AI)
        continue;
      }
      const r = await classify(line, rules, ctx);
      if (r) hit++;
      else misses.push(line);
    }
    const rate = hit / lines.length;
    if (misses.length > 0 && rate < 0.85) {
      console.error(`missed (${misses.length}/${lines.length}):`, misses.slice(0, 30));
    }
    expect(rate, `hit rate ${(rate * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.85);
  });
});
