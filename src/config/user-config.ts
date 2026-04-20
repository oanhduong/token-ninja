import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { logger } from "../utils/logger.js";

export interface Config {
  default_ai_tool?: string;
  fallback_command?: string;
  custom_rules_dir?: string;
  /**
   * When true (default), the Claude Code UserPromptSubmit hook may
   * short-circuit the model for exact/prefix rule hits, saving the full
   * turn cost. Set to false to disable interception globally without
   * uninstalling the hook.
   */
  intercept_user_prompts?: boolean;
  stats?: {
    enabled?: boolean;
    show_savings_on_exit?: boolean;
    verbose?: boolean;
  };
}

export const DEFAULT_CONFIG: Config = {
  default_ai_tool: "claude",
  fallback_command: "{{tool}} {{input}}",
  custom_rules_dir: undefined,
  intercept_user_prompts: true,
  stats: {
    enabled: true,
    show_savings_on_exit: true,
    verbose: false,
  },
};

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, "token-ninja");
}
export function configPath(): string {
  return join(configDir(), "config.yaml");
}

let cached: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (cached) return cached;
  const path = configPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    // File missing (common — defaults are fine). Don't warn.
    cached = { ...DEFAULT_CONFIG };
    return cached;
  }
  try {
    const parsed = (parseYaml(raw) as Config | null) ?? {};
    cached = { ...DEFAULT_CONFIG, ...parsed, stats: { ...DEFAULT_CONFIG.stats, ...parsed.stats } };
  } catch (err) {
    logger.warn(
      `could not parse ${path}: ${(err as Error).message}\n` +
        `  hint: fix the YAML or delete the file to restore defaults, ` +
        `then run: ninja doctor`
    );
    cached = { ...DEFAULT_CONFIG };
  }
  return cached;
}

export async function saveConfig(cfg: Config): Promise<void> {
  await mkdir(dirname(configPath()), { recursive: true });
  await writeFile(configPath(), stringifyYaml(cfg), "utf8");
  cached = cfg;
}

/**
 * `init` is kept as a compatibility alias for `setup`. Both perform the full
 * auto-install so users who remember the old name still get the new flow.
 */
export async function runInit(): Promise<void> {
  const { runSetup } = await import("../setup/index.js");
  await runSetup();
}
