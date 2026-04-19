import { execa } from "execa";
import { stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { claudeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";
import { aiderAdapter } from "./aider.js";
import { geminiAdapter } from "./gemini.js";
import { continueAdapter } from "./continue.js";
import { genericAdapter } from "./generic.js";

export interface AiAdapter {
  id: string;
  /** The binary to look for on PATH. null = no auto-detect. */
  bin: string | null;
  description: string;
  /** Override PATH-based detection; returning true means "installed". */
  detect?: () => boolean;
}

export const ADAPTERS: AiAdapter[] = [
  claudeAdapter,
  codexAdapter,
  cursorAdapter,
  aiderAdapter,
  geminiAdapter,
  continueAdapter,
  genericAdapter,
];

async function onPath(bin: string): Promise<boolean> {
  // Walk PATH directly instead of shelling out to `command -v` / `where`.
  // `command -v` in sh/bash reports shell builtins (e.g. `continue`) as
  // found, which would falsely match our Continue.dev adapter on every
  // system that has bash. A filesystem check avoids that collision and is
  // also cheaper than spawning a subshell.
  const pathEnv = process.env.PATH ?? "";
  if (!pathEnv) return false;
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").map((e) => e.toLowerCase())
    : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        const full = join(dir, bin + ext);
        const st = await stat(full);
        if (!st.isFile()) continue;
        if (process.platform === "win32") return true;
        if (st.mode & 0o111) return true;
      } catch {
        /* not found, keep looking */
      }
    }
  }
  return false;
}

/**
 * Detect the first AI tool installed on PATH, in priority order:
 * claude → codex → cursor-agent → aider → gemini → continue. Returns the
 * adapter id (e.g. "claude"), not the binary name.
 */
export async function detectAiTool(): Promise<string | null> {
  for (const a of ADAPTERS) {
    if (!a.bin) continue;
    if (a.detect ? a.detect() : await onPath(a.bin)) {
      return a.id;
    }
  }
  return null;
}

/**
 * Detect every supported AI tool that's on PATH. Preserves the ADAPTERS
 * priority order so the first entry is also what `detectAiTool()` returns.
 */
export async function detectAllInstalledAiTools(): Promise<string[]> {
  const found: string[] = [];
  for (const a of ADAPTERS) {
    if (!a.bin) continue;
    if (a.detect ? a.detect() : await onPath(a.bin)) {
      found.push(a.id);
    }
  }
  return found;
}

export function adapterFor(id: string): AiAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id || a.bin === id);
}

/**
 * Return the shell function definition that transparently wraps an AI tool
 * through `ninja`. When the user types `claude "git status"`, the function
 * hands the arg off to ninja, which either runs locally or falls back to
 * the real claude binary via its absolute path.
 */
export async function generateShim(tool: string, shellOverride?: string): Promise<string> {
  const adapter = adapterFor(tool);
  if (!adapter || !adapter.bin) {
    return `# token-ninja: unknown tool "${tool}". Supported: ${ADAPTERS.filter((a) => a.bin).map((a) => a.id).join(", ")}\n`;
  }
  const bin = adapter.bin;
  const shell = (shellOverride ?? detectShell()).toLowerCase();

  // Resolve the real binary path so the shim can skip itself when we
  // fall back, avoiding infinite recursion.
  let realPath = "";
  try {
    const r = await execa("command", ["-v", bin], { reject: false, shell: true });
    realPath = r.stdout.trim();
  } catch {
    /* ignore */
  }
  const escapedReal = realPath || bin;

  if (shell === "fish") {
    return [
      `# token-ninja shim for ${bin} (fish)`,
      `function ${bin}`,
      `  if test (count $argv) -eq 0`,
      `    command ${escapedReal}`,
      `    return $status`,
      `  end`,
      `  ninja --ai ${adapter.id} -- $argv`,
      `end\n`,
    ].join("\n");
  }

  // bash/zsh
  return [
    `# token-ninja shim for ${bin} (${shell})`,
    `${bin}() {`,
    `  if [ "$#" -eq 0 ]; then`,
    `    command ${escapedReal}`,
    `    return $?`,
    `  fi`,
    `  ninja --ai ${adapter.id} -- "$@"`,
    `}`,
    `export -f ${bin} 2>/dev/null || true`,
    ``,
  ].join("\n");
}

function detectShell(): string {
  const s = process.env.SHELL ?? "";
  if (s.endsWith("fish")) return "fish";
  if (s.endsWith("zsh")) return "zsh";
  return "bash";
}
