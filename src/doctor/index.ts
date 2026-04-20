import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ADAPTERS, detectAllInstalledAiTools } from "../adapters/index.js";
import { configDir, configPath, loadConfig } from "../config/user-config.js";
import { loadRules } from "../rules/loader.js";
import {
  BLOCK_END,
  BLOCK_START,
  detectShell,
  rcFileFor,
  type ShellName,
} from "../setup/shell-install.js";
import { mcpTargets, TOKEN_NINJA_KEY } from "../setup/mcp-install.js";
import { claudeSettingsPath, hookScriptPath } from "../setup/hook-install.js";

export type CheckStatus = "ok" | "warn" | "missing" | "error" | "info";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

export interface DoctorReport {
  version: string;
  node: string;
  platform: string;
  checks: CheckResult[];
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await readFile(p, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(path: string): Promise<unknown | "missing" | "unreadable"> {
  try {
    const raw = await readFile(path, "utf8");
    if (raw.trim() === "") return {};
    return JSON.parse(raw);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") return "missing";
    return "unreadable";
  }
}

async function checkConfig(): Promise<CheckResult> {
  const path = configPath();
  try {
    await loadConfig();
  } catch (err) {
    return {
      name: "config file",
      status: "error",
      detail: path,
      hint: `parse failed: ${(err as Error).message}. Fix the YAML or delete the file and re-run: ninja setup`,
    };
  }
  const exists = await fileExists(path);
  return {
    name: "config file",
    status: exists ? "ok" : "missing",
    detail: exists ? path : `not found at ${path}`,
    hint: exists ? undefined : "run: ninja setup",
  };
}

async function checkRules(): Promise<CheckResult> {
  try {
    const loaded = await loadRules();
    const domains = loaded.byDomain.size;
    return {
      name: "rules",
      status: "ok",
      detail: `${loaded.rules.length} rules across ${domains} domains`,
    };
  } catch (err) {
    return {
      name: "rules",
      status: "error",
      detail: (err as Error).message,
      hint: "re-run the build (dist/rules/builtin may be missing): npm run build",
    };
  }
}

async function checkUserRules(): Promise<CheckResult> {
  const cfg = await loadConfig();
  const dir = cfg.custom_rules_dir ?? join(configDir(), "rules");
  try {
    const entries = await readdir(dir);
    const yamls = entries.filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"));
    return {
      name: "user rules dir",
      status: "info",
      detail: `${dir} (${yamls.length} file${yamls.length === 1 ? "" : "s"})`,
    };
  } catch {
    return {
      name: "user rules dir",
      status: "info",
      detail: `${dir} (empty or not created)`,
      hint: "add YAML files here to define your own rules",
    };
  }
}

async function checkAdapters(): Promise<CheckResult> {
  const detected = await detectAllInstalledAiTools();
  if (detected.length === 0) {
    const supported = ADAPTERS.filter((a) => a.bin).map((a) => a.id).join(", ");
    return {
      name: "AI tools on PATH",
      status: "warn",
      detail: "none detected",
      hint: `install one of: ${supported}, or set default_ai_tool in ${configPath()}`,
    };
  }
  return {
    name: "AI tools on PATH",
    status: "ok",
    detail: detected.join(", "),
  };
}

async function checkShellShim(shell: ShellName): Promise<CheckResult> {
  const rc = rcFileFor(shell);
  try {
    const raw = await readFile(rc, "utf8");
    const hasStart = raw.includes(BLOCK_START);
    const hasEnd = raw.includes(BLOCK_END);
    if (hasStart && hasEnd) {
      return { name: "shell shim", status: "ok", detail: `${rc} (${shell})` };
    }
    if (hasStart || hasEnd) {
      return {
        name: "shell shim",
        status: "error",
        detail: `${rc} has a partial managed block`,
        hint: "run: ninja uninstall && ninja setup",
      };
    }
    return {
      name: "shell shim",
      status: "missing",
      detail: `no managed block in ${rc}`,
      hint: "run: ninja setup",
    };
  } catch {
    return {
      name: "shell shim",
      status: "missing",
      detail: `${rc} does not exist`,
      hint: "run: ninja setup",
    };
  }
}

async function checkMcpTarget(
  targetPath: string,
  label: string,
  serversKey: string
): Promise<CheckResult> {
  const parsed = await readJsonSafe(targetPath);
  if (parsed === "missing") {
    return {
      name: `mcp: ${label}`,
      status: "missing",
      detail: `${targetPath} not found`,
      hint: `open ${label} once (or run: ninja setup) to register the server`,
    };
  }
  if (parsed === "unreadable") {
    return {
      name: `mcp: ${label}`,
      status: "error",
      detail: `could not parse ${targetPath}`,
      hint: "inspect the file and fix the JSON; the token-ninja backup is at *.token-ninja.bak",
    };
  }
  const obj = parsed as Record<string, unknown>;
  const servers = obj[serversKey];
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return {
      name: `mcp: ${label}`,
      status: "missing",
      detail: `${targetPath} has no ${serversKey}`,
      hint: "run: ninja setup",
    };
  }
  const entry = (servers as Record<string, unknown>)[TOKEN_NINJA_KEY];
  if (!entry) {
    return {
      name: `mcp: ${label}`,
      status: "missing",
      detail: `${targetPath} has no ${TOKEN_NINJA_KEY} entry`,
      hint: "run: ninja setup",
    };
  }
  return { name: `mcp: ${label}`, status: "ok", detail: targetPath };
}

async function checkHook(): Promise<CheckResult> {
  const settings = claudeSettingsPath();
  const parsed = await readJsonSafe(settings);
  if (parsed === "missing") {
    return {
      name: "claude hook",
      status: "missing",
      detail: `${settings} not found`,
      hint: "open Claude Code once or run: ninja setup",
    };
  }
  if (parsed === "unreadable") {
    return {
      name: "claude hook",
      status: "error",
      detail: `could not parse ${settings}`,
      hint: "inspect the file; a backup lives at *.token-ninja.bak",
    };
  }
  const obj = parsed as Record<string, unknown>;
  const hooks = obj.hooks as Record<string, unknown> | undefined;
  const ups = hooks?.UserPromptSubmit;
  if (!Array.isArray(ups)) {
    return {
      name: "claude hook",
      status: "missing",
      detail: `no UserPromptSubmit hook in ${settings}`,
      hint: "run: ninja setup",
    };
  }
  const expectedScript = hookScriptPath();
  let found = false;
  let stale = false;
  for (const group of ups as Array<{ hooks?: Array<{ command?: string }> }>) {
    const entries = Array.isArray(group?.hooks) ? group.hooks : [];
    for (const h of entries) {
      if (typeof h?.command !== "string") continue;
      if (!h.command.includes("token-ninja")) continue;
      if (h.command.includes(expectedScript)) {
        found = true;
      } else {
        stale = true;
      }
    }
  }
  if (found) {
    return { name: "claude hook", status: "ok", detail: settings };
  }
  if (stale) {
    return {
      name: "claude hook",
      status: "warn",
      detail: `${settings} points at a different token-ninja install`,
      hint: "run: ninja setup — rewrites the hook to this install's path",
    };
  }
  return {
    name: "claude hook",
    status: "missing",
    detail: `no token-ninja UserPromptSubmit entry in ${settings}`,
    hint: "run: ninja setup",
  };
}

async function checkStats(): Promise<CheckResult> {
  const path = join(configDir(), "stats.json");
  const parsed = await readJsonSafe(path);
  if (parsed === "missing") {
    return {
      name: "stats",
      status: "info",
      detail: `no stats yet (${path})`,
      hint: "once you use ninja, totals will appear here and in: ninja stats",
    };
  }
  if (parsed === "unreadable") {
    return {
      name: "stats",
      status: "warn",
      detail: `could not parse ${path}`,
      hint: "reset with: ninja stats --reset",
    };
  }
  const s = parsed as {
    total_hits?: number;
    total_fallbacks?: number;
    total_tokens_saved_estimate?: number;
  };
  const hits = s.total_hits ?? 0;
  const falls = s.total_fallbacks ?? 0;
  const saved = s.total_tokens_saved_estimate ?? 0;
  return {
    name: "stats",
    status: "ok",
    detail: `${hits} hits · ${falls} fallbacks · ~${saved.toLocaleString("en-US")} tokens saved`,
  };
}

export async function runDoctor(): Promise<DoctorReport> {
  const shell = detectShell();
  const checks = await Promise.all<CheckResult>([
    checkConfig(),
    checkRules(),
    checkUserRules(),
    checkAdapters(),
    checkShellShim(shell),
    ...mcpTargets().map((t) => checkMcpTarget(t.path, t.label, t.serversKey)),
    checkHook(),
    checkStats(),
  ]);

  return {
    version: VERSION,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    checks,
  };
}

const VERSION = "0.4.1"; // x-release-please-version

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: "ok",
  warn: "warn",
  missing: "miss",
  error: "err",
  info: "info",
};

function colorize(s: CheckStatus, tty: boolean): string {
  const label = STATUS_LABEL[s];
  if (!tty) return label;
  const code = s === "ok" ? "32" : s === "warn" ? "33" : s === "info" ? "36" : "31";
  return `\x1b[${code}m${label}\x1b[0m`;
}

export async function printDoctor(opts: { json?: boolean } = {}): Promise<number> {
  const report = await runDoctor();
  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return hasProblems(report) ? 1 : 0;
  }
  const tty = process.stdout.isTTY === true;
  const lines: string[] = [];
  lines.push("");
  lines.push("  token-ninja doctor");
  lines.push("  " + "─".repeat(52));
  lines.push(`  version   : ${report.version}`);
  lines.push(`  node      : ${report.node}`);
  lines.push(`  platform  : ${report.platform}`);
  lines.push("");
  for (const c of report.checks) {
    lines.push(`  [${colorize(c.status, tty)}] ${c.name.padEnd(22)} ${c.detail}`);
    if (c.hint) lines.push(`         ${dimHint(c.hint, tty)}`);
  }
  lines.push("");
  const problems = hasProblems(report);
  const warnings = report.checks.some((c) => c.status === "warn");
  if (problems) {
    lines.push("  One or more checks need attention. Run `ninja setup` to fix most issues.");
  } else if (warnings) {
    lines.push("  Working, but some checks produced warnings. Review hints above.");
  } else {
    lines.push("  All checks passed.");
  }
  lines.push("");
  process.stdout.write(lines.join("\n"));
  return problems ? 1 : 0;
}

function dimHint(s: string, tty: boolean): string {
  return tty ? `\x1b[2mhint: ${s}\x1b[0m` : `hint: ${s}`;
}

function hasProblems(report: DoctorReport): boolean {
  return report.checks.some((c) => c.status === "error" || c.status === "missing");
}

// Re-export the home() dir helper — keeps the import graph shallow for tests.
export const _internals = { homedir, dirname };
