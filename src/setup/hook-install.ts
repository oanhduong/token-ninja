import { copyFile, mkdir, readFile, rename, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Claude Code UserPromptSubmit hook installer.
 *
 * Writes a small entry into `~/.claude/settings.json` so every user prompt
 * is first routed through `ninja route --strict`. On a high-confidence
 * match the hook short-circuits the model entirely (zero tokens, real
 * savings); on a miss the prompt flows to Claude as usual.
 *
 * Migration: an earlier iteration of this installer registered a
 * `PreToolUse` Bash hook. That approach couldn't save real tokens
 * (output still landed in Claude's context) and surfaced as a red error
 * panel in the UI. On install we proactively remove any lingering
 * token-ninja entry under `PreToolUse.matcher="Bash"` so upgrades are
 * clean without requiring `ninja uninstall` first.
 *
 * Merges are surgical: other matcher groups, other hooks, and unrelated
 * top-level keys are preserved, and the file is backed up once
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
 * Absolute path to the shipped hook script. Resolved off the compiled
 * module location so it works when invoked from
 * `dist/setup/hook-install.js` after `npm i -g`.
 */
export function hookScriptPath(): string {
  const here = fileURLToPath(import.meta.url);
  // dist layout: dist/setup/hook-install.js → ../../hooks/claude-code-user-prompt.cjs
  return resolve(dirname(here), "..", "..", "hooks", "claude-code-user-prompt.cjs");
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

function cloneGroups(raw: unknown): MatcherGroup[] {
  return Array.isArray(raw)
    ? (raw as MatcherGroup[]).map((g) => ({
        matcher: g?.matcher,
        hooks: Array.isArray(g?.hooks) ? [...g.hooks] : [],
      }))
    : [];
}

/**
 * Strip every token-ninja hook command from a set of matcher groups.
 * Drops emptied groups. Returns the filtered array and whether anything
 * changed.
 */
function stripTokenNinjaFromGroups(groups: MatcherGroup[]): {
  next: MatcherGroup[];
  changed: boolean;
} {
  let changed = false;
  const next = groups
    .map((group) => {
      const hooks = Array.isArray(group.hooks) ? group.hooks : [];
      const filtered = hooks.filter((h) => !isTokenNinjaCommand(h?.command));
      if (filtered.length !== hooks.length) changed = true;
      return { ...group, hooks: filtered };
    })
    .filter((group) => (group.hooks?.length ?? 0) > 0);
  return { next, changed };
}

/**
 * Merge our UserPromptSubmit hook into the parsed settings object. Also
 * migrates users off the deprecated PreToolUse Bash hook by removing any
 * token-ninja entry found there. Returns a fresh copy and a `changed` flag.
 */
export function mergeHookEntry(
  existing: unknown,
  scriptPath: string
): { next: Record<string, unknown>; changed: boolean } {
  const base: Record<string, unknown> = isObject(existing) ? { ...existing } : {};
  const hooksRoot = isObject(base.hooks) ? { ...(base.hooks as Record<string, unknown>) } : {};

  let changed = false;

  // Migration: drop any stale token-ninja command from PreToolUse.
  const preToolUseBefore = cloneGroups(hooksRoot.PreToolUse);
  if (preToolUseBefore.length > 0) {
    const { next: preToolUseAfter, changed: preChanged } = stripTokenNinjaFromGroups(
      preToolUseBefore
    );
    if (preChanged) {
      changed = true;
      if (preToolUseAfter.length === 0) {
        delete hooksRoot.PreToolUse;
      } else {
        hooksRoot.PreToolUse = preToolUseAfter;
      }
    }
  }

  // Install: ensure the UserPromptSubmit group has our command.
  const upsGroups = cloneGroups(hooksRoot.UserPromptSubmit);
  const desiredCommand = hookCommand(scriptPath);
  const desiredHook: HookEntry = { type: "command", command: desiredCommand };

  // UserPromptSubmit groups have no matcher field per Claude Code docs.
  // We install into (or create) the first matcher-less group.
  let hostGroup = upsGroups.find((g) => g.matcher === undefined || g.matcher === "");
  if (!hostGroup) {
    hostGroup = { hooks: [] };
    upsGroups.push(hostGroup);
  }
  const hostHooks = Array.isArray(hostGroup.hooks) ? hostGroup.hooks : [];
  const tnIdx = hostHooks.findIndex((h) => isTokenNinjaCommand(h?.command));
  if (tnIdx === -1) {
    hostGroup.hooks = [desiredHook, ...hostHooks];
    changed = true;
  } else {
    const prev = hostHooks[tnIdx];
    if (!prev || prev.command !== desiredCommand) {
      hostHooks[tnIdx] = { ...(prev ?? {}), ...desiredHook };
      hostGroup.hooks = hostHooks;
      changed = true;
    }
  }

  if (!changed) {
    return { next: base, changed: false };
  }

  hooksRoot.UserPromptSubmit = upsGroups;
  if (Object.keys(hooksRoot).length === 0) {
    delete base.hooks;
  } else {
    base.hooks = hooksRoot;
  }
  return { next: base, changed: true };
}

/**
 * Remove our hook from the settings object — both the current
 * UserPromptSubmit entry and any legacy PreToolUse Bash entry left by
 * prior versions. Drops empty matcher groups and empty containers so
 * uninstall is a clean inverse of install.
 */
export function removeHookEntry(existing: unknown): {
  next: Record<string, unknown>;
  changed: boolean;
} {
  if (!isObject(existing)) return { next: {}, changed: false };
  const base: Record<string, unknown> = { ...existing };
  const hooksRoot = isObject(base.hooks) ? { ...(base.hooks as Record<string, unknown>) } : null;
  if (!hooksRoot) return { next: base, changed: false };

  let changed = false;

  for (const event of ["UserPromptSubmit", "PreToolUse"] as const) {
    const groups = cloneGroups(hooksRoot[event]);
    if (groups.length === 0) continue;
    const { next: after, changed: eventChanged } = stripTokenNinjaFromGroups(groups);
    if (!eventChanged) continue;
    changed = true;
    if (after.length === 0) {
      delete hooksRoot[event];
    } else {
      hooksRoot[event] = after;
    }
  }

  if (!changed) return { next: base, changed: false };

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
