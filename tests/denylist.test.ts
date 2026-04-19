import { describe, expect, it } from "vitest";
import { DENY_PATTERNS, findDenyMatches } from "../src/safety/denylist.js";

describe("denylist inventory", () => {
  it("has a non-empty pattern list", () => {
    expect(DENY_PATTERNS.length).toBeGreaterThan(20);
  });

  it("every entry has id/pattern/reason", () => {
    for (const p of DENY_PATTERNS) {
      expect(p.id).toBeTypeOf("string");
      expect(p.pattern).toBeInstanceOf(RegExp);
      expect(p.reason).toBeTypeOf("string");
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.reason.length).toBeGreaterThan(0);
    }
  });

  it("every id is unique", () => {
    const ids = new Set(DENY_PATTERNS.map((p) => p.id));
    expect(ids.size).toBe(DENY_PATTERNS.length);
  });

  it("all regexes compile and are case-insensitive", () => {
    for (const p of DENY_PATTERNS) {
      expect(p.pattern.flags.includes("i")).toBe(true);
    }
  });
});

describe("findDenyMatches — positive", () => {
  it("matches rm -rf", () => {
    const hits = findDenyMatches("rm -rf /");
    expect(hits.some((h) => h.id === "rm-rf")).toBe(true);
  });
  it("matches git push --force but not --force-with-lease", () => {
    expect(findDenyMatches("git push --force").some((h) => h.id === "git-push-force")).toBe(true);
    expect(findDenyMatches("git push --force-with-lease").some((h) => h.id === "git-push-force")).toBe(false);
  });
  it("matches git push -f", () => {
    expect(findDenyMatches("git push -f").some((h) => h.id === "git-push-force")).toBe(true);
  });
  it("matches sudo", () => {
    expect(findDenyMatches("sudo apt update").some((h) => h.id === "sudo")).toBe(true);
  });
  it("matches SQL DROP TABLE", () => {
    expect(findDenyMatches("drop table users").some((h) => h.id === "sql-drop")).toBe(true);
  });
  it("matches DELETE FROM without WHERE", () => {
    expect(findDenyMatches("delete from users").some((h) => h.id === "sql-delete-nowhere")).toBe(true);
  });
  it("does not match DELETE FROM with WHERE", () => {
    expect(findDenyMatches("delete from users where id = 1").some((h) => h.id === "sql-delete-nowhere")).toBe(false);
  });
  it("matches UPDATE without WHERE", () => {
    expect(findDenyMatches("update users set name = 'x'").some((h) => h.id === "sql-update-nowhere")).toBe(true);
  });
  it("does not match UPDATE with WHERE", () => {
    expect(findDenyMatches("update users set name = 'x' where id = 1").some((h) => h.id === "sql-update-nowhere")).toBe(false);
  });
});

describe("findDenyMatches — negative", () => {
  const safe = [
    "git status",
    "ls -la",
    "npm install",
    "mkdir -p dist",
    "echo hello",
    "cat README.md",
    "git push origin main",
    "docker ps",
    "kubectl get pods",
  ];
  for (const cmd of safe) {
    it(`does not flag: ${cmd}`, () => {
      expect(findDenyMatches(cmd)).toEqual([]);
    });
  }
});
