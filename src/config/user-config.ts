import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { logger } from "../utils/logger.js";

/**
 * The one fallback template that needs no shell. `fallbackToAi` special-cases
 * it and spawns the AI tool with the input as a single argv entry; anything
 * else goes through a shell with every substitution quoted.
 */
export const DEFAULT_FALLBACK_COMMAND = "{{tool}} {{input}}";

/** Locally-executed commands are killed after this long unless overridden. */
export const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
/** Captured stdout/stderr is truncated past this many bytes per stream. */
export const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;

export interface Config {
  default_ai_tool?: string;
  fallback_command?: string;
  /**
   * Directory holding the user's own rule YAML files. Supports `~` and paths
   * relative to the config dir. Defaults to `<configDir>/rules`.
   */
  custom_rules_dir?: string;
  /**
   * When true (default), the Claude Code UserPromptSubmit hook may
   * short-circuit the model for exact/prefix rule hits, saving the full
   * turn cost. Set to false to disable interception globally without
   * uninstalling the hook.
   */
  intercept_user_prompts?: boolean;
  /** Limits applied to every locally-executed command. */
  exec?: {
    /** Kill a local command after this many ms. 0 disables the timeout. */
    timeout_ms?: number;
    /** Truncate captured stdout/stderr past this many bytes. 0 disables. */
    max_output_bytes?: number;
  };
  stats?: {
    /** When false, no counters are recorded and stats.json is never written. */
    enabled?: boolean;
    show_savings_on_exit?: boolean;
    verbose?: boolean;
  };
}

export const DEFAULT_CONFIG: Config = {
  default_ai_tool: "claude",
  fallback_command: DEFAULT_FALLBACK_COMMAND,
  custom_rules_dir: undefined,
  intercept_user_prompts: true,
  exec: {
    timeout_ms: DEFAULT_EXEC_TIMEOUT_MS,
    max_output_bytes: DEFAULT_MAX_OUTPUT_BYTES,
  },
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

/**
 * Resolve a user-supplied directory. YAML has no notion of `~`, so a config
 * line like `custom_rules_dir: ~/.config/token-ninja/rules` parses to the
 * literal string "~/..." — expand it here or the path silently points at a
 * directory named "~" inside the cwd.
 */
export function expandPath(p: string, base = configDir()): string {
  const trimmed = p.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }
  if (isAbsolute(trimmed)) return trimmed;
  return resolve(base, trimmed);
}

/** Absolute path of the directory holding the user's own rule files. */
export function userRulesDir(cfg: Config): string {
  return cfg.custom_rules_dir
    ? expandPath(cfg.custom_rules_dir)
    : join(configDir(), "rules");
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
    cached = {
      ...DEFAULT_CONFIG,
      ...parsed,
      exec: { ...DEFAULT_CONFIG.exec, ...parsed.exec },
      stats: { ...DEFAULT_CONFIG.stats, ...parsed.stats },
    };
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

/** Drop the memoized config. Tests mutate XDG_CONFIG_HOME between cases. */
export function invalidateConfigCache(): void {
  cached = null;
}

/**
 * `init` is kept as a compatibility alias for `setup`. Both perform the full
 * auto-install so users who remember the old name still get the new flow.
 */
export async function runInit(): Promise<void> {
  const { runSetup } = await import("../setup/index.js");
  await runSetup();
}
