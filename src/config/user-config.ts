import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { detectAiTool } from "../adapters/index.js";
import { logger } from "../utils/logger.js";

export interface Config {
  default_ai_tool?: string;
  fallback_command?: string;
  custom_rules_dir?: string;
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
  stats: {
    enabled: true,
    show_savings_on_exit: false,
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
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = (parseYaml(raw) as Config | null) ?? {};
    cached = { ...DEFAULT_CONFIG, ...parsed, stats: { ...DEFAULT_CONFIG.stats, ...parsed.stats } };
  } catch {
    cached = { ...DEFAULT_CONFIG };
  }
  return cached;
}

export async function saveConfig(cfg: Config): Promise<void> {
  await mkdir(dirname(configPath()), { recursive: true });
  await writeFile(configPath(), stringifyYaml(cfg), "utf8");
  cached = cfg;
}

export async function runInit(): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "rules"), { recursive: true });

  const detected = await detectAiTool();
  const cfg: Config = {
    ...DEFAULT_CONFIG,
    default_ai_tool: detected ?? DEFAULT_CONFIG.default_ai_tool,
    custom_rules_dir: join(dir, "rules"),
  };
  await saveConfig(cfg);

  const msg = [
    `token-ninja configured.`,
    `  config      : ${configPath()}`,
    `  AI tool     : ${cfg.default_ai_tool}${detected ? " (detected)" : " (default — override in config.yaml)"}`,
    `  user rules  : ${cfg.custom_rules_dir}`,
    ``,
    `Add a shell function (recommended) so "claude ..." runs through ninja:`,
    `  # zsh / bash`,
    `  ninja shim claude >> ~/.zshrc    # or ~/.bashrc`,
    ``,
    `Try it:`,
    `  ninja "git status"           # runs locally, zero tokens`,
    `  ninja "build the project"    # detects build tool from repo`,
    `  ninja stats                  # cumulative savings`,
    `  ninja rules test "git diff"  # see which rule matches`,
  ].join("\n");
  process.stdout.write(msg + "\n");
  logger.debug("init complete");
}
