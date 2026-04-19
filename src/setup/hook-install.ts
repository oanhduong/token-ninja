import { copyFile, mkdir, readFile, rename, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Claude Code PreToolUse Bash-hook installer.
 *
 * Writes a small entry into `~/.claude/settings.json` so every Bash tool call
 * first consults `ninja route` — deterministic commands are answered locally
 * and the Bash call is blocked. The merge is surgical: we keep every other
 * hook, matcher, and top-level key intact, and back the file up once
 * (`settings.json.token-ninja.bak`) before the first modification.
 */

const TOKEN_NINJA_MARKER = "token-ninja";

export interface HookInstallResult {
  path: string;
  changed: boolean;
  created: boolean;
  backupPath: string | null;
  skippedReason?: string;
}

export function claudeSettingsPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  return env.CLAUDE_SETTINGS_PATH ?? join(home, ".claude", "settings.json");
}

/**
 * Absolute path to the shipped hook script (hooks/claude-code-bash.cjs at
 * package root). Resolved off the compiled module location so it works when
 * invoked from `dist/setup/hook-install.js` after `npm i -g`.
 */
export function hookScriptPath(): string {
  const here = fileURLToPath(import.meta.url);
  // dist layout: dist/setup/hook-install.js → ../../hooks/claude-code-bash.cjs
  return resolve(dirname(here), "..", "..", "hooks", "claude-code-bash.cjs");
}

export function hookCommand(scriptPath: string = hookScriptPath()): string {
  return `node ${JSON.stringify(scriptPath)}`;
}

interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
}

interface MatcherGroup {
  matcher?: string;
  hooks?: HookEntry[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isTokenNinjaCommand(cmd: unknown): boolean {
  if (typeof cmd !== "string") return false;
  return cmd.includes(TOKEN_NINJA_MARKER);
}

/**
 * Merge our Bash PreToolUse hook into the parsed settings object. Returns a
 * fresh copy and a `changed` flag. If an entry already points at the same
 * script path, we leave the file alone. If there's a stale token-ninja entry
 * with a different path (e.g. package upgraded), we rewrite it.
 */
export function mergeHookEntry(
  existing: unknown,
  scriptPath: string
): { next: Record<string, unknown>; changed: boolean } {
  const base: Record<string, unknown> = isObject(existing) ? { ...existing } : {};
  const hooksRoot = isObject(base.hooks) ? { ...(base.hooks as Record<string, unknown>) } : {};
  const preToolUseRaw = hooksRoot.PreToolUse;
  const preToolUse: MatcherGroup[] = Array.isArray(preToolUseRaw)
    ? (preToolUseRaw as MatcherGroup[]).map((g) => ({
        matcher: g?.matcher,
        hooks: Array.isArray(g?.hooks) ? [...g.hooks] : [],
      }))
    : [];

  const desiredCommand = hookCommand(scriptPath);
  const desiredHook: HookEntry = { type: "command", command: desiredCommand };

  let changed = false;
  let foundBashGroup = false;
  for (const group of preToolUse) {
    if (group.matcher !== "Bash") continue;
    foundBashGroup = true;
    const existingHooks = Array.isArray(group.hooks) ? group.hooks : [];
    const tnIdx = existingHooks.findIndex((h) => isTokenNinjaCommand(h?.command));
    if (tnIdx === -1) {
      group.hooks = [desiredHook, ...existingHooks];
      changed = true;
    } else {
      const prev = existingHooks[tnIdx];
      if (!prev || prev.command !== desiredCommand) {
        existingHooks[tnIdx] = { ...(prev ?? {}), ...desiredHook };
        group.hooks = existingHooks;
        changed = true;
      }
    }
  }

  if (!foundBashGroup) {
    preToolUse.push({ matcher: "Bash", hooks: [desiredHook] });
    changed = true;
  }

  if (!changed) {
    return { next: base, changed: false };
  }

  hooksRoot.PreToolUse = preToolUse;
  base.hooks = hooksRoot;
  return { next: base, changed: true };
}

/**
 * Remove our hook from the settings object. Drops empty matcher groups and
 * empty `hooks.PreToolUse` / `hooks` containers so uninstall is a clean
 * inverse of install.
 */
export function removeHookEntry(existing: unknown): {
  next: Record<string, unknown>;
  changed: boolean;
} {
  if (!isObject(existing)) return { next: {}, changed: false };
  const base: Record<string, unknown> = { ...existing };
  const hooksRoot = isObject(base.hooks) ? { ...(base.hooks as Record<string, unknown>) } : null;
  if (!hooksRoot || !Array.isArray(hooksRoot.PreToolUse)) {
    return { next: base, changed: false };
  }

  let changed = false;
  const preToolUse: MatcherGroup[] = (hooksRoot.PreToolUse as MatcherGroup[])
    .map((group) => {
      const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
      const filtered = hooks.filter((h) => !isTokenNinjaCommand(h?.command));
      if (filtered.length !== hooks.length) changed = true;
      return { ...group, hooks: filtered };
    })
    .filter((group) => (group.hooks?.length ?? 0) > 0);

  if (!changed) return { next: base, changed: false };

  if (preToolUse.length === 0) {
    delete hooksRoot.PreToolUse;
  } else {
    hooksRoot.PreToolUse = preToolUse;
  }
  if (Object.keys(hooksRoot).length === 0) {
    delete base.hooks;
  } else {
    base.hooks = hooksRoot;
  }
  return { next: base, changed: true };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.token-ninja.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

export interface InstallHookOpts {
  path?: string;
  scriptPath?: string;
  dryRun?: boolean;
}

export async function installHook(opts: InstallHookOpts = {}): Promise<HookInstallResult> {
  const path = opts.path ?? claudeSettingsPath();
  const scriptPath = opts.scriptPath ?? hookScriptPath();
  const existed = await fileExists(path);

  let parsed: unknown = {};
  if (existed) {
    try {
      const raw = await readFile(path, "utf8");
      parsed = raw.trim() === "" ? {} : JSON.parse(raw);
    } catch (err) {
      return {
        path,
        changed: false,
        created: false,
        backupPath: null,
        skippedReason: `could not parse ${path}: ${(err as Error).message}`,
      };
    }
  }

  const { next, changed } = mergeHookEntry(parsed, scriptPath);
  if (!changed) {
    return { path, changed: false, created: false, backupPath: null };
  }

  if (opts.dryRun) {
    return { path, changed: true, created: !existed, backupPath: null };
  }

  let backupPath: string | null = null;
  if (existed) {
    const candidate = `${path}.token-ninja.bak`;
    if (!(await fileExists(candidate))) {
      try {
        await copyFile(path, candidate);
        backupPath = candidate;
      } catch {
        backupPath = null;
      }
    }
  }

  try {
    await writeAtomic(path, JSON.stringify(next, null, 2) + "\n");
  } catch (err) {
    return {
      path,
      changed: false,
      created: false,
      backupPath,
      skippedReason: `could not write ${path}: ${(err as Error).message}`,
    };
  }

  return { path, changed: true, created: !existed, backupPath };
}

export async function uninstallHook(
  opts: { path?: string } = {}
): Promise<{ path: string; changed: boolean }> {
  const path = opts.path ?? claudeSettingsPath();
  if (!(await fileExists(path))) return { path, changed: false };

  let parsed: unknown;
  try {
    const raw = await readFile(path, "utf8");
    parsed = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    return { path, changed: false };
  }

  const { next, changed } = removeHookEntry(parsed);
  if (!changed) return { path, changed: false };

  try {
    await writeAtomic(path, JSON.stringify(next, null, 2) + "\n");
    return { path, changed: true };
  } catch {
    return { path, changed: false };
  }
}
