import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export const REPO_MARKERS = [
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "Pipfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "mix.exs",
  "Makefile",
  "deno.json",
  "deno.jsonc",
] as const;

export type RepoMarker = (typeof REPO_MARKERS)[number];

async function exists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

export async function detectMarkers(cwd: string): Promise<Set<RepoMarker>> {
  const found = new Set<RepoMarker>();
  await Promise.all(
    REPO_MARKERS.map(async (m) => {
      if (await exists(join(cwd, m))) found.add(m);
    })
  );
  return found;
}

export interface PackageJsonScripts {
  test?: string;
  build?: string;
  dev?: string;
  start?: string;
  lint?: string;
  format?: string;
  [key: string]: string | undefined;
}

export async function readPackageJsonScripts(cwd: string): Promise<PackageJsonScripts | null> {
  try {
    const raw = await readFile(join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: PackageJsonScripts };
    return pkg.scripts ?? {};
  } catch {
    return null;
  }
}

export interface PackageManager {
  name: "npm" | "yarn" | "pnpm" | "bun";
  lockfile: string;
}

export async function detectNodePackageManager(cwd: string): Promise<PackageManager | null> {
  const candidates: PackageManager[] = [
    { name: "bun", lockfile: "bun.lockb" },
    { name: "pnpm", lockfile: "pnpm-lock.yaml" },
    { name: "yarn", lockfile: "yarn.lock" },
    { name: "npm", lockfile: "package-lock.json" },
  ];
  for (const c of candidates) {
    if (await exists(join(cwd, c.lockfile))) return c;
  }
  try {
    const raw = await readFile(join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { packageManager?: string };
    if (pkg.packageManager) {
      const name = pkg.packageManager.split("@")[0]?.toLowerCase();
      if (name === "npm" || name === "yarn" || name === "pnpm" || name === "bun") {
        return { name, lockfile: "package.json#packageManager" };
      }
    }
    return { name: "npm", lockfile: "package.json" };
  } catch {
    return null;
  }
}

export type PythonTool = "poetry" | "uv" | "pipenv" | "pip";

export async function detectPythonTool(cwd: string): Promise<PythonTool | null> {
  if (await exists(join(cwd, "poetry.lock"))) return "poetry";
  if (await exists(join(cwd, "uv.lock"))) return "uv";
  if (await exists(join(cwd, "Pipfile"))) return "pipenv";
  if (
    (await exists(join(cwd, "pyproject.toml"))) ||
    (await exists(join(cwd, "requirements.txt"))) ||
    (await exists(join(cwd, "setup.py")))
  ) {
    return "pip";
  }
  return null;
}

/**
 * Resolve a detect-style action for NL rules that depend on repo markers.
 * Each `when` is a marker name; first match wins.
 */
export async function resolveDetect(
  cwd: string,
  detect: Array<{ when: string; command: string }>,
  fallback?: string
): Promise<string | null> {
  const markers = await detectMarkers(cwd);
  const pm = await detectNodePackageManager(cwd);
  const py = await detectPythonTool(cwd);
  const scripts = await readPackageJsonScripts(cwd);

  for (const entry of detect) {
    const when = entry.when;
    if (markers.has(when as RepoMarker)) return entry.command;
    if (when === `pm:${pm?.name}` && pm) return entry.command;
    if (when === `py:${py}` && py) return entry.command;
    if (when.startsWith("script:")) {
      const name = when.slice("script:".length);
      if (scripts && typeof scripts[name] === "string") return entry.command;
    }
  }
  return fallback ?? null;
}
