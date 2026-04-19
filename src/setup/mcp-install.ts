import { readFile, writeFile, access, mkdir, copyFile, rename } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

/**
 * Zero-config MCP registration. Writes `token-ninja` into each MCP-capable
 * client's config file so interactive agent sessions (Claude Code REPL,
 * Cursor, Claude Desktop) consult `ninja mcp` automatically. We merge rather
 * than replace: every other key in the target file is preserved, we back it
 * up once before the first modification, and we skip writes when our entry
 * is already present with the same command.
 */

export const TOKEN_NINJA_KEY = "token-ninja";

export interface McpClientTarget {
  /** Stable id used in logs and dry-run output. */
  id: "claude-code" | "cursor" | "claude-desktop";
  /** Human-readable label. */
  label: string;
  /** Path to the config file we'd write. */
  path: string;
  /** Which top-level key in the file holds the server map. */
  serversKey: string;
}

export interface McpInstallResult {
  target: McpClientTarget;
  changed: boolean;
  created: boolean;
  skippedReason?: string;
  backupPath: string | null;
}

export interface McpServerEntry {
  command: string;
  args?: string[];
}

export const MCP_SERVER_ENTRY: McpServerEntry = {
  command: "ninja",
  args: ["mcp"],
};

export function mcpTargets(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  os: NodeJS.Platform = platform()
): McpClientTarget[] {
  const out: McpClientTarget[] = [];

  // Claude Code — user-scoped config. The file is created on first `claude`
  // run; if it doesn't exist yet we create it rather than skip, so a fresh
  // install works on the user's first REPL session.
  out.push({
    id: "claude-code",
    label: "Claude Code",
    path: env.CLAUDE_CONFIG_PATH ?? join(home, ".claude.json"),
    serversKey: "mcpServers",
  });

  // Cursor — per-user MCP config.
  out.push({
    id: "cursor",
    label: "Cursor",
    path: join(home, ".cursor", "mcp.json"),
    serversKey: "mcpServers",
  });

  // Claude Desktop — OS-specific.
  let desktopPath: string | null = null;
  if (os === "darwin") {
    desktopPath = join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  } else if (os === "win32") {
    const appdata = env.APPDATA ?? join(home, "AppData", "Roaming");
    desktopPath = join(appdata, "Claude", "claude_desktop_config.json");
  } else {
    const xdg = env.XDG_CONFIG_HOME ?? join(home, ".config");
    desktopPath = join(xdg, "Claude", "claude_desktop_config.json");
  }
  out.push({
    id: "claude-desktop",
    label: "Claude Desktop",
    path: desktopPath,
    serversKey: "mcpServers",
  });

  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge a `token-ninja` server entry into the parsed config. Returns the new
 * object (always a fresh copy) and a flag indicating whether anything
 * changed. Non-object inputs produce a new object; non-object `mcpServers`
 * is replaced with a fresh map to avoid corrupting the file.
 */
export function mergeMcpEntry(
  existing: unknown,
  serversKey: string,
  entry: McpServerEntry = MCP_SERVER_ENTRY
): { next: Record<string, unknown>; changed: boolean } {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  const currentServers = base[serversKey];
  const servers: Record<string, unknown> =
    currentServers && typeof currentServers === "object" && !Array.isArray(currentServers)
      ? { ...(currentServers as Record<string, unknown>) }
      : {};

  const prev = servers[TOKEN_NINJA_KEY];
  const prevMatches =
    prev !== undefined &&
    typeof prev === "object" &&
    prev !== null &&
    (prev as Record<string, unknown>).command === entry.command &&
    JSON.stringify((prev as Record<string, unknown>).args ?? []) ===
      JSON.stringify(entry.args ?? []);

  if (prevMatches) {
    return { next: base, changed: false };
  }

  servers[TOKEN_NINJA_KEY] = { ...entry };
  base[serversKey] = servers;
  return { next: base, changed: true };
}

/**
 * Strip our entry out of the parsed config. Leaves other servers intact.
 */
export function removeMcpEntry(
  existing: unknown,
  serversKey: string
): { next: Record<string, unknown>; changed: boolean } {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return { next: {}, changed: false };
  }
  const base = { ...(existing as Record<string, unknown>) };
  const currentServers = base[serversKey];
  if (!currentServers || typeof currentServers !== "object" || Array.isArray(currentServers)) {
    return { next: base, changed: false };
  }
  const servers = { ...(currentServers as Record<string, unknown>) };
  if (!(TOKEN_NINJA_KEY in servers)) {
    return { next: base, changed: false };
  }
  delete servers[TOKEN_NINJA_KEY];
  base[serversKey] = servers;
  return { next: base, changed: true };
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.token-ninja.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

export interface InstallMcpOpts {
  dryRun?: boolean;
  targets?: McpClientTarget[];
}

export async function installMcp(opts: InstallMcpOpts = {}): Promise<McpInstallResult[]> {
  const targets = opts.targets ?? mcpTargets();
  const results: McpInstallResult[] = [];

  for (const target of targets) {
    const existed = await fileExists(target.path);
    let parsed: unknown = null;
    if (existed) {
      try {
        const raw = await readFile(target.path, "utf8");
        parsed = raw.trim() === "" ? {} : JSON.parse(raw);
      } catch (err) {
        results.push({
          target,
          changed: false,
          created: false,
          backupPath: null,
          skippedReason: `could not parse ${target.path}: ${(err as Error).message}`,
        });
        continue;
      }
    }

    const { next, changed } = mergeMcpEntry(parsed ?? {}, target.serversKey);
    if (!changed) {
      results.push({ target, changed: false, created: false, backupPath: null });
      continue;
    }

    if (opts.dryRun) {
      results.push({ target, changed: true, created: !existed, backupPath: null });
      continue;
    }

    let backupPath: string | null = null;
    if (existed) {
      const candidate = `${target.path}.token-ninja.bak`;
      if (!(await fileExists(candidate))) {
        backupPath = candidate;
        try {
          await copyFile(target.path, candidate);
        } catch {
          backupPath = null;
        }
      }
    }

    try {
      await writeAtomic(target.path, JSON.stringify(next, null, 2) + "\n");
    } catch (err) {
      results.push({
        target,
        changed: false,
        created: false,
        backupPath,
        skippedReason: `could not write ${target.path}: ${(err as Error).message}`,
      });
      continue;
    }

    results.push({ target, changed: true, created: !existed, backupPath });
  }

  return results;
}

export async function uninstallMcp(opts: { targets?: McpClientTarget[] } = {}): Promise<
  Array<{ target: McpClientTarget; changed: boolean }>
> {
  const targets = opts.targets ?? mcpTargets();
  const results: Array<{ target: McpClientTarget; changed: boolean }> = [];

  for (const target of targets) {
    if (!(await fileExists(target.path))) {
      results.push({ target, changed: false });
      continue;
    }
    let parsed: unknown;
    try {
      const raw = await readFile(target.path, "utf8");
      parsed = raw.trim() === "" ? {} : JSON.parse(raw);
    } catch {
      results.push({ target, changed: false });
      continue;
    }
    const { next, changed } = removeMcpEntry(parsed, target.serversKey);
    if (!changed) {
      results.push({ target, changed: false });
      continue;
    }
    try {
      await writeAtomic(target.path, JSON.stringify(next, null, 2) + "\n");
      results.push({ target, changed: true });
    } catch {
      results.push({ target, changed: false });
    }
  }

  return results;
}
