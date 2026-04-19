import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BLOCK_END,
  BLOCK_START,
  detectShell,
  installBlock,
  rcFileFor,
  replaceBlock,
  uninstallBlock,
} from "../src/setup/shell-install.js";

describe("replaceBlock", () => {
  it("inserts a managed block when none exists", () => {
    const out = replaceBlock("export PATH=/usr/bin\n", "claude() { echo hi; }");
    expect(out).toContain(BLOCK_START);
    expect(out).toContain("claude() { echo hi; }");
    expect(out).toContain(BLOCK_END);
    // Existing content preserved.
    expect(out.startsWith("export PATH=/usr/bin\n")).toBe(true);
  });

  it("is idempotent: replacing with the same block yields the same content", () => {
    const first = replaceBlock("", "X=1");
    const second = replaceBlock(first, "X=1");
    expect(second).toBe(first);
  });

  it("replaces an existing managed block in place, preserving surrounding content", () => {
    const existing =
      "line1\n" +
      `${BLOCK_START}\nold-body\n${BLOCK_END}\n` +
      "line-after\n";
    const out = replaceBlock(existing, "new-body");
    expect(out).toContain("new-body");
    expect(out).not.toContain("old-body");
    expect(out.startsWith("line1\n")).toBe(true);
    expect(out.endsWith("line-after\n")).toBe(true);
  });

  it("removes the managed block when given an empty body", () => {
    const existing =
      "before\n" +
      `${BLOCK_START}\nbody\n${BLOCK_END}\n` +
      "after\n";
    const out = replaceBlock(existing, "");
    expect(out).not.toContain(BLOCK_START);
    expect(out).not.toContain(BLOCK_END);
    expect(out).toBe("before\nafter\n");
  });
});

describe("detectShell / rcFileFor", () => {
  it("detects zsh / bash / fish from $SHELL", () => {
    expect(detectShell({ SHELL: "/bin/zsh" })).toBe("zsh");
    expect(detectShell({ SHELL: "/usr/local/bin/fish" })).toBe("fish");
    expect(detectShell({ SHELL: "/bin/bash" })).toBe("bash");
    expect(detectShell({})).toBe("bash");
  });

  it("returns sensible rc paths per shell", () => {
    const home = "/tmp/fakehome";
    expect(rcFileFor("zsh", {}, home)).toBe("/tmp/fakehome/.zshrc");
    expect(rcFileFor("bash", {}, home)).toBe("/tmp/fakehome/.bashrc");
    expect(rcFileFor("fish", {}, home)).toBe("/tmp/fakehome/.config/fish/config.fish");
  });

  it("honours TOKEN_NINJA_RC_FILE override", () => {
    expect(rcFileFor("zsh", { TOKEN_NINJA_RC_FILE: "/tmp/custom" }, "/home/x")).toBe("/tmp/custom");
  });
});

describe("installBlock / uninstallBlock", () => {
  let dir = "";
  let rcPath = "";
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tn-shell-"));
    rcPath = join(dir, ".zshrc");
    env = { TOKEN_NINJA_RC_FILE: rcPath };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the rc file if it doesn't exist", async () => {
    const r = await installBlock("claude() { :; }", "zsh", env);
    expect(r.changed).toBe(true);
    expect(r.created).toBe(true);
    const content = await readFile(rcPath, "utf8");
    expect(content).toContain("claude()");
  });

  it("is a no-op when the same block already exists", async () => {
    await installBlock("X=1", "zsh", env);
    const second = await installBlock("X=1", "zsh", env);
    expect(second.changed).toBe(false);
  });

  it("backs up the original rc file once when modifying an existing one", async () => {
    await writeFile(rcPath, "export EDITOR=vim\n", "utf8");
    const r1 = await installBlock("X=1", "zsh", env);
    expect(r1.backupPath).toBe(`${rcPath}.token-ninja.bak`);
    const backup = await readFile(r1.backupPath!, "utf8");
    expect(backup).toBe("export EDITOR=vim\n");

    // Second install — same block → no change, no new backup.
    const r2 = await installBlock("X=1", "zsh", env);
    expect(r2.changed).toBe(false);
    expect(r2.backupPath).toBeNull();
  });

  it("uninstall removes the block and leaves surrounding content intact", async () => {
    await writeFile(rcPath, "before\n", "utf8");
    await installBlock("X=1", "zsh", env);
    const r = await uninstallBlock("zsh", env);
    expect(r.changed).toBe(true);
    const after = await readFile(rcPath, "utf8");
    expect(after).not.toContain(BLOCK_START);
    expect(after).toContain("before");
  });

  it("uninstall on a file without the block is a no-op", async () => {
    await writeFile(rcPath, "only-user-content\n", "utf8");
    const r = await uninstallBlock("zsh", env);
    expect(r.changed).toBe(false);
  });
});
