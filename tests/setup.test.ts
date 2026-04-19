import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLOCK_START } from "../src/setup/shell-install.js";
import { runSetup, runUninstall } from "../src/setup/index.js";

let dir = "";
let rcPath = "";
let origEnv: NodeJS.ProcessEnv;
let stdout = "";
let origWrite: typeof process.stdout.write;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tn-setup-"));
  rcPath = join(dir, ".zshrc");
  origEnv = { ...process.env };
  process.env.TOKEN_NINJA_RC_FILE = rcPath;
  process.env.XDG_CONFIG_HOME = join(dir, "xdg");
  process.env.HOME = dir;
  stdout = "";
  origWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
});

afterEach(async () => {
  process.stdout.write = origWrite;
  process.env = origEnv;
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runSetup", () => {
  it("writes a shim block covering the requested tool", async () => {
    const code = await runSetup({ shell: "zsh", tools: ["claude"], quiet: true });
    expect(code).toBe(0);
    const content = await readFile(rcPath, "utf8");
    expect(content).toContain(BLOCK_START);
    expect(content).toContain("claude()");
    expect(content).toContain("ninja --ai claude");
  });

  it("dry-run prints the block but does not write the rc file", async () => {
    const code = await runSetup({ shell: "zsh", tools: ["claude"], dryRun: true });
    expect(code).toBe(0);
    expect(stdout).toContain("[dry-run]");
    expect(stdout).toContain("claude()");
    await expect(readFile(rcPath, "utf8")).rejects.toBeTruthy();
  });

  it("is idempotent across repeated setups with the same tools", async () => {
    await runSetup({ shell: "zsh", tools: ["claude"], quiet: true });
    const first = await readFile(rcPath, "utf8");
    await runSetup({ shell: "zsh", tools: ["claude"], quiet: true });
    const second = await readFile(rcPath, "utf8");
    expect(second).toBe(first);
  });

  it("hooks multiple tools when requested", async () => {
    await runSetup({ shell: "zsh", tools: ["claude", "codex"], quiet: true });
    const content = await readFile(rcPath, "utf8");
    expect(content).toContain("claude()");
    expect(content).toContain("codex()");
  });

  it("prints guidance when no tools are detected or requested", async () => {
    const code = await runSetup({ shell: "zsh", tools: [] });
    expect(code).toBe(0);
    // Either it hooked something detected on this machine, or it printed the
    // "no supported AI tool detected" hint. Both outcomes are valid.
    const rcExists = await readFile(rcPath, "utf8").then(() => true).catch(() => false);
    if (!rcExists) {
      expect(stdout).toContain("no supported AI tool detected");
    }
  });
});

describe("runUninstall", () => {
  it("removes the block that setup installed", async () => {
    await runSetup({ shell: "zsh", tools: ["claude"], quiet: true });
    const code = await runUninstall({ shell: "zsh", quiet: true });
    expect(code).toBe(0);
    const content = await readFile(rcPath, "utf8");
    expect(content).not.toContain(BLOCK_START);
  });
});
