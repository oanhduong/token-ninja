import { readFile, writeFile, access, mkdir, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const BLOCK_START = "# >>> token-ninja >>>";
export const BLOCK_END = "# <<< token-ninja <<<";

export type ShellName = "bash" | "zsh" | "fish";

/**
 * Detect the user's shell from $SHELL. Defaults to bash.
 */
export function detectShell(env: NodeJS.ProcessEnv = process.env): ShellName {
  const s = (env.SHELL ?? "").toLowerCase();
  if (s.endsWith("fish")) return "fish";
  if (s.endsWith("zsh")) return "zsh";
  return "bash";
}

/**
 * The rc file we should append to for the given shell. Users can override
 * via TOKEN_NINJA_RC_FILE — useful for tests and for esoteric setups.
 */
export function rcFileFor(
  shell: ShellName,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  if (env.TOKEN_NINJA_RC_FILE) return env.TOKEN_NINJA_RC_FILE;
  if (shell === "fish") {
    const xdg = env.XDG_CONFIG_HOME ?? join(home, ".config");
    return join(xdg, "fish", "config.fish");
  }
  if (shell === "zsh") return join(home, ".zshrc");
  return join(home, ".bashrc");
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
 * Replace (or insert) the managed token-ninja block in `content`. Returns
 * the new file content. If `block` is empty, the managed block is removed.
 */
export function replaceBlock(content: string, block: string): string {
  const startIdx = content.indexOf(BLOCK_START);
  const endIdx = content.indexOf(BLOCK_END);
  const trimmedBlock = block.trim();
  const wrapped =
    trimmedBlock.length === 0
      ? ""
      : `${BLOCK_START}\n# managed — regenerate with: ninja setup · remove with: ninja uninstall\n${trimmedBlock}\n${BLOCK_END}\n`;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Also swallow a single trailing newline after BLOCK_END so repeated
    // setup/uninstall cycles don't grow blank lines.
    let tailStart = endIdx + BLOCK_END.length;
    if (content[tailStart] === "\n") tailStart += 1;
    const before = content.slice(0, startIdx);
    const after = content.slice(tailStart);
    const joined = before + wrapped + after;
    return joined;
  }

  if (trimmedBlock.length === 0) return content;
  const sep = content.length === 0 || content.endsWith("\n") ? "" : "\n";
  return `${content}${sep}\n${wrapped}`;
}

export interface InstallResult {
  rcFile: string;
  changed: boolean;
  created: boolean;
  backupPath: string | null;
}

/**
 * Write the managed block into the shell's rc file. Idempotent: if the file
 * already contains an identical block, we skip writing. A one-time .bak
 * copy is made the first time we modify an existing file.
 */
export async function installBlock(
  block: string,
  shell: ShellName,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): Promise<InstallResult> {
  const rcFile = rcFileFor(shell, env, home);
  const existed = await fileExists(rcFile);
  const existing = existed ? await readFile(rcFile, "utf8") : "";
  const next = replaceBlock(existing, block);
  if (next === existing) {
    return { rcFile, changed: false, created: false, backupPath: null };
  }
  let backupPath: string | null = null;
  if (existed && !(await fileExists(`${rcFile}.token-ninja.bak`))) {
    backupPath = `${rcFile}.token-ninja.bak`;
    await copyFile(rcFile, backupPath);
  }
  await mkdir(dirname(rcFile), { recursive: true });
  await writeFile(rcFile, next, "utf8");
  return { rcFile, changed: true, created: !existed, backupPath };
}

/**
 * Remove the managed block. Returns true if anything was removed.
 */
export async function uninstallBlock(
  shell: ShellName,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): Promise<{ rcFile: string; changed: boolean }> {
  const rcFile = rcFileFor(shell, env, home);
  if (!(await fileExists(rcFile))) return { rcFile, changed: false };
  const existing = await readFile(rcFile, "utf8");
  const next = replaceBlock(existing, "");
  if (next === existing) return { rcFile, changed: false };
  await writeFile(rcFile, next, "utf8");
  return { rcFile, changed: true };
}
