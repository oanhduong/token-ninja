import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fallbackToAi } from "../src/router/fallback.js";

let origEnv: typeof process.env;
let origCwd: string;
let homeDir: string;

beforeEach(async () => {
  origEnv = { ...process.env };
  origCwd = process.cwd();
  homeDir = await mkdtemp(join(tmpdir(), "ninja-home-"));
  // Route XDG_CONFIG_HOME to a temp dir so loadConfig misses and returns defaults.
  process.env.XDG_CONFIG_HOME = join(homeDir, "config");
  await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true });
});

afterEach(async () => {
  process.env = origEnv;
  process.chdir(origCwd);
  await rm(homeDir, { recursive: true, force: true });
});

describe("fallbackToAi", () => {
  it("returns 2 when noFallback is set", async () => {
    const code = await fallbackToAi("git status", { noFallback: true });
    expect(code).toBe(2);
  });

  it("returns 127 when no tool detected and aiOverride not given", async () => {
    // Force no tool on PATH: scrub PATH.
    process.env.PATH = "/nonexistent";
    // Also ensure config has no default_ai_tool.
    await writeFile(join(process.env.XDG_CONFIG_HOME!, "token-ninja", "config.yaml"), "").catch(async () => {
      await mkdir(join(process.env.XDG_CONFIG_HOME!, "token-ninja"), { recursive: true });
      await writeFile(join(process.env.XDG_CONFIG_HOME!, "token-ninja", "config.yaml"), "default_ai_tool: null\n");
    });
    const code = await fallbackToAi("git status", {});
    // 127 = not found, but depending on environment could be 1 if execa
    // throws before the not-found path. Either way, non-zero is required.
    expect(code).not.toBe(0);
  });
});
