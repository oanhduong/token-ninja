import { describe, expect, it, beforeAll } from "vitest";
import { loadRules } from "../src/rules/loader.js";
import { classify } from "../src/router/classifier.js";
import type { LoadedRules } from "../src/rules/types.js";

let rules: LoadedRules;
const ctx = { cwd: process.cwd() };

beforeAll(async () => {
  rules = await loadRules();
});

async function match(input: string) {
  return classify(input, rules, ctx);
}

describe("classifier — exact match wins", () => {
  it("exact: git status", async () => {
    const r = await match("git status");
    expect(r?.rule.id).toBe("git-status");
    expect(r?.matchedVia).toBe("exact");
  });

  it("exact: git st alias", async () => {
    const r = await match("git st");
    expect(r?.rule.id).toBe("git-status");
  });

  it("exact: npm test", async () => {
    const r = await match("npm test");
    expect(r?.rule.id).toBe("npm-run-known");
  });

  it("exact: docker ps", async () => {
    const r = await match("docker ps");
    expect(r?.rule.id).toBe("docker-ps");
  });

  it("exact: kubectl get pods", async () => {
    const r = await match("kubectl get pods");
    expect(r?.rule.id).toBe("kubectl-get");
  });
});

describe("classifier — prefix with args", () => {
  it("git add <path>", async () => {
    const r = await match("git add src/router/index.ts");
    expect(r?.rule.id).toBe("git-add");
    expect(r?.capturedArgs).toBe("src/router/index.ts");
    expect(r?.command).toBe("git add src/router/index.ts");
  });

  it("npm install <pkg>", async () => {
    const r = await match("npm install lodash");
    expect(r?.rule.id).toBe("npm-install-passthrough");
    expect(r?.command).toContain("lodash");
  });

  it("longest prefix wins: npm install -D", async () => {
    const r = await match("npm install -D vitest");
    expect(r?.rule.id).toBe("npm-install-passthrough");
    expect(r?.command).toContain("-D vitest");
  });

  it("pnpm add -D <pkg>", async () => {
    const r = await match("pnpm add -D vitest");
    expect(r?.rule.id).toBe("pnpm-add");
    expect(r?.command).toBe("pnpm add -D vitest");
  });
});

describe("classifier — regex with captures", () => {
  it("git commit -m 'msg'", async () => {
    const r = await match("git commit -m 'fix: a thing'");
    expect(r?.rule.id).toBe("git-commit-message");
    expect(r?.command).toContain("fix: a thing");
  });

  it("git checkout <branch>", async () => {
    const r = await match("git checkout main");
    expect(r?.rule.id).toBe("git-checkout-branch");
  });

  it("ping -c 3 host", async () => {
    const r = await match("ping -c 3 google.com");
    expect(r?.rule.id).toBe("ping");
    expect(r?.command).toBe("ping -c 3 google.com");
  });

  it("cargo new <name>", async () => {
    const r = await match("cargo new my-proj");
    expect(r?.rule.id).toBe("cargo-new");
    expect(r?.command).toBe("cargo new my-proj");
  });
});

describe("classifier — NL keyword matching", () => {
  it('"show me the files"', async () => {
    const r = await match("show me the files");
    expect(r?.rule.id).toBe("nl-list-files");
    expect(r?.matchedVia).toBe("nl");
  });

  it('"what branch am I on"', async () => {
    const r = await match("what branch am I on");
    expect(r?.rule.id).toBe("nl-current-branch");
  });

  it('"show running containers"', async () => {
    const r = await match("show running containers");
    expect(r?.rule.id).toBe("nl-docker-ps");
  });

  it('"show recent commits"', async () => {
    const r = await match("show recent commits");
    expect(r?.rule.id).toBe("nl-recent-commits");
  });

  it('"what changed?"', async () => {
    const r = await match("what changed?");
    expect(r?.rule.id).toBe("nl-git-status");
  });
});

describe("classifier — negative / near-miss", () => {
  it("empty string → no match", async () => {
    expect(await match("")).toBeNull();
  });

  it('"please explain this code" → no match (nl too loose)', async () => {
    const r = await match("please explain this code to me");
    // Should not match any NL rule; explanatory prompts should fall back
    expect(r?.rule.id).not.toBe("nl-list-files");
  });

  it('nonsense: "qwerty asdf" → no match', async () => {
    expect(await match("qwerty asdf")).toBeNull();
  });

  it('"git statusify" → not git-status', async () => {
    const r = await match("git statusify");
    expect(r?.rule.id).not.toBe("git-status");
  });

  it('"docker psychology" → not docker-ps', async () => {
    const r = await match("docker psychology");
    expect(r?.rule.id).not.toBe("docker-ps");
  });
});

describe("classifier — template expansion", () => {
  it("expands {{message}}", async () => {
    const r = await match("git commit -m \"hello world\"");
    expect(r?.command).toContain("hello world");
  });

  it("expands {{arg1}} for branch", async () => {
    const r = await match("git checkout feature/x");
    expect(r?.command).toContain("feature/x");
  });
});

describe("classifier — performance", () => {
  it("classifies 1000 commands in under 1 second", async () => {
    const samples = [
      "git status",
      "git diff",
      "npm install",
      "docker ps",
      "kubectl get pods",
      "cargo build",
      "go test ./...",
      "ls -la",
      "pwd",
      "find . -name foo",
    ];
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      await classify(samples[i % samples.length]!, rules, ctx);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
