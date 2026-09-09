import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FALLBACK_COMMAND,
  expandPath,
  invalidateConfigCache,
  loadConfig,
  userRulesDir,
} from "../src/config/user-config.js";
import { invalidateRulesCache, loadRules } from "../src/rules/loader.js";

let home: string;
let ninjaDir: string;
let origEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  origEnv = { ...process.env };
  home = await mkdtemp(join(tmpdir(), "ninja-cfg-"));
  process.env.XDG_CONFIG_HOME = join(home, "config");
  ninjaDir = join(process.env.XDG_CONFIG_HOME, "token-ninja");
  await mkdir(ninjaDir, { recursive: true });
  invalidateRulesCache();
});

afterEach(async () => {
  process.env = origEnv;
  invalidateRulesCache();
  invalidateConfigCache();
  await rm(home, { recursive: true, force: true });
});

describe("expandPath", () => {
  it("expands a bare ~ to the home directory", () => {
    expect(expandPath("~")).toBe(homedir());
  });

  it("expands ~/… — YAML has no tilde expansion of its own", () => {
    expect(expandPath("~/rules")).toBe(join(homedir(), "rules"));
  });

  it("leaves an absolute path alone", () => {
    expect(expandPath("/opt/ninja/rules")).toBe("/opt/ninja/rules");
  });

  it("resolves a relative path against the given base", () => {
    expect(expandPath("rules", "/base")).toBe("/base/rules");
  });
});

describe("userRulesDir", () => {
  it("defaults to <configDir>/rules", () => {
    expect(userRulesDir({})).toBe(join(ninjaDir, "rules"));
  });

  it("honours custom_rules_dir", () => {
    expect(userRulesDir({ custom_rules_dir: "/custom/place" })).toBe("/custom/place");
  });

  it("expands ~ inside custom_rules_dir", () => {
    expect(userRulesDir({ custom_rules_dir: "~/my-rules" })).toBe(join(homedir(), "my-rules"));
  });
});

describe("loadConfig", () => {
  it("falls back to defaults when the file is missing", async () => {
    const cfg = await loadConfig();
    expect(cfg.fallback_command).toBe(DEFAULT_FALLBACK_COMMAND);
    expect(cfg.stats?.enabled).toBe(true);
    expect(cfg.exec?.timeout_ms).toBeGreaterThan(0);
  });

  it("merges nested exec/stats blocks over the defaults", async () => {
    await writeFile(join(ninjaDir, "config.yaml"), "exec:\n  timeout_ms: 999\n", "utf8");
    invalidateConfigCache();
    const cfg = await loadConfig();
    expect(cfg.exec?.timeout_ms).toBe(999);
    // untouched sibling keeps its default rather than vanishing
    expect(cfg.exec?.max_output_bytes).toBeGreaterThan(0);
    expect(cfg.stats?.enabled).toBe(true);
  });

  it("falls back to defaults on malformed YAML", async () => {
    await writeFile(join(ninjaDir, "config.yaml"), "default_ai_tool: [unclosed\n", "utf8");
    invalidateConfigCache();
    const cfg = await loadConfig();
    expect(cfg.fallback_command).toBe(DEFAULT_FALLBACK_COMMAND);
  });
});

describe("custom_rules_dir is actually loaded", () => {
  it("picks up rules from the configured directory", async () => {
    const custom = join(home, "my-rules");
    await mkdir(custom, { recursive: true });
    await writeFile(
      join(custom, "extra.yaml"),
      [
        "domain: custom",
        "rules:",
        "  - id: custom-hello",
        "    match: { type: exact, patterns: ['ninja-test-hello'] }",
        "    action: { type: shell, command: 'echo hello' }",
        "    safety: read-only",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(ninjaDir, "config.yaml"),
      `custom_rules_dir: ${custom}\n`,
      "utf8"
    );
    invalidateRulesCache();

    const rules = await loadRules();
    expect(rules.rules.some((r) => r.id === "custom-hello")).toBe(true);
    expect(rules.exactIndex.get("ninja-test-hello")?.id).toBe("custom-hello");
  });

  it("ignores the default dir once custom_rules_dir points elsewhere", async () => {
    const defaultDir = join(ninjaDir, "rules");
    await mkdir(defaultDir, { recursive: true });
    await writeFile(
      join(defaultDir, "ignored.yaml"),
      [
        "domain: custom",
        "rules:",
        "  - id: should-not-load",
        "    match: { type: exact, patterns: ['ninja-test-ignored'] }",
        "    action: { type: shell, command: 'echo nope' }",
        "    safety: read-only",
      ].join("\n"),
      "utf8"
    );
    const custom = join(home, "elsewhere");
    await mkdir(custom, { recursive: true });
    await writeFile(join(ninjaDir, "config.yaml"), `custom_rules_dir: ${custom}\n`, "utf8");
    invalidateRulesCache();

    const rules = await loadRules();
    expect(rules.rules.some((r) => r.id === "should-not-load")).toBe(false);
  });
});
