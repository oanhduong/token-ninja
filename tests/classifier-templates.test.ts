import { beforeAll, describe, expect, it } from "vitest";
import { loadRules } from "../src/rules/loader.js";
import { classify } from "../src/router/classifier.js";
import type { LoadedRules } from "../src/rules/types.js";

let rules: LoadedRules;
const ctx = { cwd: process.cwd() };

beforeAll(async () => {
  rules = await loadRules();
});

describe("classifier — template expansion & args_passthrough", () => {
  it("preserves flags between base command and matched prefix (pnpm add -D)", async () => {
    const r = await classify("pnpm add -D vitest", rules, ctx);
    expect(r?.rule.id).toBe("pnpm-add");
    expect(r?.command).toBe("pnpm add -D vitest");
  });

  it("preserves flags for npm install -D (longest prefix case)", async () => {
    const r = await classify("npm install -D vitest", rules, ctx);
    expect(r?.command).toBe("npm install -D vitest");
  });

  it("preserves flags for git add -A (prefix pattern)", async () => {
    const r = await classify("git add -A", rules, ctx);
    expect(r?.rule.id).toBe("git-add");
    expect(r?.command).toBe("git add -A");
  });

  it("preserves multi-word args in git commit -m", async () => {
    const r = await classify("git commit -m \"fix: a thing\"", rules, ctx);
    expect(r?.rule.id).toBe("git-commit-message");
    expect(r?.command).toBe("git commit -m \"fix: a thing\"");
  });

  it("does not duplicate the `git commit` prefix (regression)", async () => {
    const r = await classify("git commit -m 'hello'", rules, ctx);
    expect(r?.command).toBe("git commit -m 'hello'");
    expect(r?.command.startsWith("git commit git")).toBe(false);
  });

  it("matches git commit with flags before -m", async () => {
    const r = await classify("git commit --allow-empty -m \"empty\"", rules, ctx);
    expect(r?.rule.id).toBe("git-commit-message");
    expect(r?.command).toBe("git commit --allow-empty -m \"empty\"");
  });

  it("matches git commit -S -m (signed)", async () => {
    const r = await classify("git commit -S -m \"signed\"", rules, ctx);
    expect(r?.rule.id).toBe("git-commit-message");
    expect(r?.command).toBe("git commit -S -m \"signed\"");
  });

  it("matches git commit --amend --no-edit cleanly", async () => {
    const r = await classify("git commit --amend --no-edit", rules, ctx);
    expect(r?.rule.id).toBe("git-commit-amend-message");
    expect(r?.command).toBe("git commit --amend --no-edit");
  });

  it("expands {{arg1}} for checkout branch", async () => {
    const r = await classify("git checkout main", rules, ctx);
    expect(r?.rule.id).toBe("git-checkout-branch");
    expect(r?.command).toContain("main");
  });

  it("alias expansion: git st → git status", async () => {
    const r = await classify("git st", rules, ctx);
    expect(r?.rule.id).toBe("git-status");
    expect(r?.matchedVia).toBe("exact");
    expect(r?.command).toBe("git status");
  });
});

describe("classifier — no infinite confusion", () => {
  it("unknown command returns null", async () => {
    expect(await classify("nonsensecmd --foo", rules, ctx)).toBeNull();
  });

  it("empty string returns null", async () => {
    expect(await classify("", rules, ctx)).toBeNull();
    expect(await classify("   ", rules, ctx)).toBeNull();
  });
});
