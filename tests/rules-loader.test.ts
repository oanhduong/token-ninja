import { describe, expect, it, beforeEach } from "vitest";
import { invalidateRulesCache, loadRules } from "../src/rules/loader.js";

beforeEach(() => {
  invalidateRulesCache();
});

describe("rules/loader", () => {
  it("caches between calls", async () => {
    const a = await loadRules();
    const b = await loadRules();
    expect(a).toBe(b);
  });

  it("invalidateRulesCache forces a fresh load", async () => {
    const a = await loadRules();
    invalidateRulesCache();
    const b = await loadRules();
    expect(a).not.toBe(b);
    // but contents should be equivalent
    expect(a.rules.length).toBe(b.rules.length);
  });

  it("partitions rules by match type", async () => {
    const r = await loadRules();
    const sum =
      r.exactIndex.size + r.prefixRules.length + r.regexRules.length + r.nlRules.length;
    // exactIndex may have multiple patterns per rule — use rule arrays as canonical
    const byType = {
      exact: r.rules.filter((x) => x.match.type === "exact").length,
      prefix: r.prefixRules.length,
      regex: r.regexRules.length,
      nl: r.nlRules.length,
    };
    expect(byType.prefix).toBeGreaterThan(0);
    expect(byType.regex).toBeGreaterThan(0);
    expect(byType.nl).toBeGreaterThan(0);
    expect(byType.exact).toBeGreaterThan(0);
    expect(sum).toBeGreaterThan(0);
  });

  it("byDomain includes git and npm", async () => {
    const r = await loadRules();
    expect(r.byDomain.get("git")?.length).toBeGreaterThan(0);
    expect(r.byDomain.get("npm")?.length).toBeGreaterThan(0);
  });

  it("every rule id is unique", async () => {
    const r = await loadRules();
    const ids = r.rules.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
