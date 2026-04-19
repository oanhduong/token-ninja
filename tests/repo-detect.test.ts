import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  detectMarkers,
  detectNodePackageManager,
  detectPythonTool,
  readPackageJsonScripts,
  resolveDetect,
} from "../src/utils/repo-detect.js";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ninja-repo-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("repo-detect", () => {
  it("detects package.json marker", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({
      scripts: { test: "vitest", build: "tsc" },
      packageManager: "pnpm@9.0.0",
    }));
    const markers = await detectMarkers(dir);
    expect(markers.has("package.json")).toBe(true);
  });

  it("reads package.json scripts", async () => {
    const s = await readPackageJsonScripts(dir);
    expect(s?.test).toBe("vitest");
    expect(s?.build).toBe("tsc");
  });

  it("returns null for missing package.json", async () => {
    const empty = await mkdtemp(join(tmpdir(), "ninja-empty-"));
    expect(await readPackageJsonScripts(empty)).toBeNull();
    await rm(empty, { recursive: true, force: true });
  });

  it("detects pnpm from lockfile", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    const pm = await detectNodePackageManager(dir);
    expect(pm?.name).toBe("pnpm");
  });

  it("detects pip when only requirements.txt exists", async () => {
    const py = await mkdtemp(join(tmpdir(), "ninja-py-"));
    await writeFile(join(py, "requirements.txt"), "");
    expect(await detectPythonTool(py)).toBe("pip");
    await rm(py, { recursive: true, force: true });
  });

  it("detects poetry when poetry.lock exists", async () => {
    const py = await mkdtemp(join(tmpdir(), "ninja-poetry-"));
    await writeFile(join(py, "poetry.lock"), "");
    expect(await detectPythonTool(py)).toBe("poetry");
    await rm(py, { recursive: true, force: true });
  });

  it("resolveDetect picks the first matching detect entry", async () => {
    const cmd = await resolveDetect(
      dir,
      [
        { when: "Cargo.toml", command: "cargo build" },
        { when: "package.json", command: "pnpm build" },
      ],
      "make"
    );
    expect(cmd).toBe("pnpm build");
  });

  it("resolveDetect returns fallback when no entry matches", async () => {
    const empty = await mkdtemp(join(tmpdir(), "ninja-fb-"));
    const cmd = await resolveDetect(
      empty,
      [{ when: "Cargo.toml", command: "cargo build" }],
      "make"
    );
    expect(cmd).toBe("make");
    await rm(empty, { recursive: true, force: true });
  });

  it("resolveDetect matches pm: prefix on detected package manager", async () => {
    const cmd = await resolveDetect(
      dir,
      [{ when: "pm:pnpm", command: "pnpm install" }],
      "npm install"
    );
    expect(cmd).toBe("pnpm install");
  });

  it("resolveDetect matches script: prefix when package.json has the script", async () => {
    const cmd = await resolveDetect(
      dir,
      [{ when: "script:test", command: "pnpm test" }],
      "echo no-test"
    );
    expect(cmd).toBe("pnpm test");
  });
});
