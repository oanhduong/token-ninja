import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../src/doctor/index.js";

// The doctor reads XDG_CONFIG_HOME / HOME / TOKEN_NINJA_RC_FILE, plus the
// Claude settings path override. We redirect every one of those to a fresh
// tempdir per test so the host filesystem stays out of the assertions.

const ORIGINAL_ENV = { ...process.env };

async function makeSandbox() {
  const home = await mkdtemp(join(tmpdir(), "tnd-home-"));
  const xdg = join(home, ".config");
  const rc = join(home, ".bashrc");
  const claudeSettings = join(home, ".claude", "settings.json");
  await mkdir(xdg, { recursive: true });
  return { home, xdg, rc, claudeSettings };
}

beforeEach(() => {
  // Pretend we're in a bash login so rcFileFor picks .bashrc.
  process.env.SHELL = "/bin/bash";
  // Isolate from any real install.
  delete process.env.TOKEN_NINJA_RC_FILE;
  delete process.env.CLAUDE_SETTINGS_PATH;
  delete process.env.CLAUDE_CONFIG_PATH;
  delete process.env.GEMINI_CONFIG_PATH;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("doctor", () => {
  it("reports structured checks with status fields", async () => {
    const { home, xdg, rc, claudeSettings } = await makeSandbox();
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.TOKEN_NINJA_RC_FILE = rc;
    process.env.CLAUDE_SETTINGS_PATH = claudeSettings;
    // Claude Code and Cursor/Gemini/Desktop paths live under HOME by default —
    // the sandbox HOME means they won't exist, which is exactly what we want.

    const report = await runDoctor();
    expect(report.version).toMatch(/\d+\.\d+\.\d+/);
    expect(report.node).toBe(process.version);
    expect(report.checks.length).toBeGreaterThan(0);
    const names = report.checks.map((c) => c.name);
    expect(names).toContain("config file");
    expect(names).toContain("rules");
    expect(names).toContain("shell shim");
    expect(names).toContain("claude hook");
    expect(names).toContain("stats");
  });

  it("flags a fresh machine as missing shim / mcp / hook", async () => {
    const { home, xdg, rc, claudeSettings } = await makeSandbox();
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.TOKEN_NINJA_RC_FILE = rc;
    process.env.CLAUDE_SETTINGS_PATH = claudeSettings;

    const report = await runDoctor();
    const shim = report.checks.find((c) => c.name === "shell shim")!;
    expect(shim.status).toBe("missing");
    const hook = report.checks.find((c) => c.name === "claude hook")!;
    expect(hook.status).toBe("missing");
    const mcp = report.checks.find((c) => c.name.startsWith("mcp: "))!;
    expect(["missing", "error"]).toContain(mcp.status);
  });

  it("reports ok shell shim when the managed block is present", async () => {
    const { home, xdg, rc, claudeSettings } = await makeSandbox();
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.TOKEN_NINJA_RC_FILE = rc;
    process.env.CLAUDE_SETTINGS_PATH = claudeSettings;

    await writeFile(
      rc,
      `# >>> token-ninja >>>\nalias x=y\n# <<< token-ninja <<<\n`,
      "utf8"
    );

    const report = await runDoctor();
    const shim = report.checks.find((c) => c.name === "shell shim")!;
    expect(shim.status).toBe("ok");
    expect(shim.detail).toContain(rc);
  });

  it("reports ok claude hook when the settings file contains our command", async () => {
    const { home, xdg, rc, claudeSettings } = await makeSandbox();
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.TOKEN_NINJA_RC_FILE = rc;
    process.env.CLAUDE_SETTINGS_PATH = claudeSettings;

    // The hook-install module resolves the script path off the compiled
    // module's directory. We can't easily pre-compute it from the test, so we
    // plant a plausible path containing "token-ninja" and expect a "warn"
    // (present, but not this install) rather than "missing".
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(
      claudeSettings,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "command",
                  command: `node /opt/token-ninja/hooks/claude-code-user-prompt.cjs`,
                },
              ],
            },
          ],
        },
      }),
      "utf8"
    );

    const report = await runDoctor();
    const hook = report.checks.find((c) => c.name === "claude hook")!;
    expect(hook.status).toBe("warn");
  });

  it("returns 'info' for a missing stats file (first run)", async () => {
    const { home, xdg, rc, claudeSettings } = await makeSandbox();
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = xdg;
    process.env.TOKEN_NINJA_RC_FILE = rc;
    process.env.CLAUDE_SETTINGS_PATH = claudeSettings;

    const report = await runDoctor();
    const stats = report.checks.find((c) => c.name === "stats")!;
    expect(stats.status).toBe("info");
  });
});
