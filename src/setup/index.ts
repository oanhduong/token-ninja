import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ADAPTERS, adapterFor, detectAllInstalledAiTools, generateShim } from "../adapters/index.js";
import { configDir, configPath, loadConfig, saveConfig, DEFAULT_CONFIG } from "../config/user-config.js";
import type { Config } from "../config/user-config.js";
import { detectShell, installBlock, uninstallBlock, rcFileFor } from "./shell-install.js";
import type { ShellName } from "./shell-install.js";
import { logger } from "../utils/logger.js";

export interface SetupOpts {
  /** Explicit shell override (bash|zsh|fish). */
  shell?: string;
  /** Hook these tool ids even if not detected on PATH. */
  tools?: string[];
  /** Print minimal output (used by postinstall). */
  quiet?: boolean;
  /** Don't write anything; just report what would change. */
  dryRun?: boolean;
}

function normalizeShell(s: string | undefined): ShellName {
  const v = (s ?? "").toLowerCase();
  if (v === "fish" || v === "zsh" || v === "bash") return v;
  return detectShell();
}

/**
 * Build the managed rc-file block: one shim per hooked tool, plus a trailing
 * stats hint so new shells print a breadcrumb once.
 */
async function buildBlock(toolIds: string[], shell: ShellName): Promise<string> {
  const parts: string[] = [];
  for (const id of toolIds) {
    parts.push((await generateShim(id, shell)).trimEnd());
  }
  return parts.join("\n\n");
}

export async function runSetup(opts: SetupOpts = {}): Promise<number> {
  const shell = normalizeShell(opts.shell);

  const dir = configDir();
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "rules"), { recursive: true });

  const detected = await detectAllInstalledAiTools();
  const requested = (opts.tools ?? []).map((t) => t.trim()).filter(Boolean);
  const hooked = dedupe([...requested, ...detected]).filter((id) => {
    const a = adapterFor(id);
    return a && a.bin;
  });

  if (hooked.length === 0) {
    if (!opts.quiet) {
      process.stdout.write(
        [
          "token-ninja: no supported AI tool detected on PATH.",
          `  Supported: ${ADAPTERS.filter((a) => a.bin).map((a) => a.id).join(", ")}`,
          `  After installing one, re-run: ninja setup`,
          "",
        ].join("\n")
      );
    }
    // Still write a default config so `ninja` runs have sane defaults.
    await ensureConfig(detected[0]);
    return 0;
  }

  const block = await buildBlock(hooked, shell);
  const rcFile = rcFileFor(shell);

  if (opts.dryRun) {
    process.stdout.write(
      [
        `[dry-run] would hook ${hooked.join(", ")} in ${rcFile}`,
        `[dry-run] shell: ${shell}`,
        "",
      ].join("\n")
    );
    process.stdout.write(block + "\n");
    return 0;
  }

  const result = await installBlock(block, shell);
  await ensureConfig(hooked[0]);

  if (!opts.quiet) {
    const lines = [
      `token-ninja ready.`,
      `  shell       : ${shell}`,
      `  rc file     : ${result.rcFile}${result.created ? " (created)" : ""}`,
      `  hooked      : ${hooked.join(", ")}`,
      `  config      : ${configPath()}`,
    ];
    if (result.backupPath) lines.push(`  backup      : ${result.backupPath}`);
    if (!result.changed) lines.push(`  (already installed — no changes)`);
    lines.push(``);
    lines.push(`Open a new terminal (or: source ${result.rcFile}) and use your AI tool normally.`);
    lines.push(`Commands token-ninja recognizes run locally; everything else passes through.`);
    lines.push(`See cumulative savings: ninja stats`);
    process.stdout.write(lines.join("\n") + "\n");
  }
  logger.debug("setup complete");
  return 0;
}

export async function runUninstall(opts: { shell?: string; quiet?: boolean } = {}): Promise<number> {
  const shell = normalizeShell(opts.shell);
  const result = await uninstallBlock(shell);
  if (!opts.quiet) {
    if (result.changed) {
      process.stdout.write(`token-ninja: removed managed block from ${result.rcFile}\n`);
      process.stdout.write(`Open a new terminal (or: source ${result.rcFile}) to restore original AI tool behavior.\n`);
    } else {
      process.stdout.write(`token-ninja: no managed block found in ${result.rcFile}\n`);
    }
  }
  return 0;
}

async function ensureConfig(defaultTool: string | undefined): Promise<void> {
  const existing = await loadConfig();
  const next: Config = {
    ...DEFAULT_CONFIG,
    ...existing,
    default_ai_tool: existing.default_ai_tool ?? defaultTool ?? DEFAULT_CONFIG.default_ai_tool,
    custom_rules_dir: existing.custom_rules_dir ?? join(configDir(), "rules"),
    stats: { ...DEFAULT_CONFIG.stats, ...existing.stats },
  };
  await saveConfig(next);
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
