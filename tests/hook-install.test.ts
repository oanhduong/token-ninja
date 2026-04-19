import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hookCommand,
  installHook,
  mergeHookEntry,
  removeHookEntry,
  uninstallHook,
} from "../src/setup/hook-install.js";

const SCRIPT = "/opt/token-ninja/hooks/claude-code-user-prompt.cjs";
const STALE_BASH_COMMAND = 'node "/old/path/token-ninja/hooks/claude-code-bash.cjs"';

describe("mergeHookEntry", () => {
  it("adds a UserPromptSubmit group when none exists", () => {
    const { next, changed } = mergeHookEntry({}, SCRIPT);
    expect(changed).toBe(true);
    const hooks = (next.hooks as Record<string, unknown>).UserPromptSubmit as Array<{
      matcher?: string;
      hooks: Array<{ type: string; command: string }>;
    }>;
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.matcher).toBeUndefined();
    expect(hooks[0]!.hooks[0]!.command).toBe(hookCommand(SCRIPT));
  });

  it("preserves other top-level keys and other event groups", () => {
    const existing = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Write|Edit",
            hooks: [{ type: "command", command: "node other-guard.js" }],
          },
        ],
        PostToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "bash after.sh" }] },
        ],
      },
      statusLine: { type: "command", command: "echo hi" },
    };
    const { next, changed } = mergeHookEntry(existing, SCRIPT);
    expect(changed).toBe(true);

    expect((next as typeof existing).statusLine).toEqual({ type: "command", command: "echo hi" });
    const hooksRoot = next.hooks as Record<string, unknown>;
    expect(hooksRoot.PostToolUse).toEqual(existing.hooks.PostToolUse);
    const pre = hooksRoot.PreToolUse as Array<{ matcher?: string }>;
    expect(pre.find((g) => g.matcher === "Write|Edit")).toBeTruthy();
    const ups = hooksRoot.UserPromptSubmit as Array<{
      hooks: Array<{ command: string }>;
    }>;
    expect(ups[0]!.hooks[0]!.command).toBe(hookCommand(SCRIPT));
  });

  it("migrates off a legacy PreToolUse Bash token-ninja entry during install", () => {
    const stale = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: STALE_BASH_COMMAND },
              { type: "command", command: "bash unrelated.sh" },
            ],
          },
          {
            matcher: "Write|Edit",
            hooks: [{ type: "command", command: "node guard.js" }],
          },
        ],
      },
    };
    const { next, changed } = mergeHookEntry(stale, SCRIPT);
    expect(changed).toBe(true);
    const hooksRoot = next.hooks as Record<string, unknown>;
    const pre = hooksRoot.PreToolUse as Array<{ matcher: string; hooks: Array<{ command: string }> }>;
    // Legacy token-ninja Bash command is gone, the sibling entry survives.
    const bash = pre.find((g) => g.matcher === "Bash")!;
    expect(bash.hooks.map((h) => h.command)).toEqual(["bash unrelated.sh"]);
    expect(pre.find((g) => g.matcher === "Write|Edit")).toBeTruthy();
    // UserPromptSubmit entry installed.
    const ups = hooksRoot.UserPromptSubmit as Array<{ hooks: Array<{ command: string }> }>;
    expect(ups[0]!.hooks[0]!.command).toBe(hookCommand(SCRIPT));
  });

  it("drops a fully-emptied Bash group after migration", () => {
    const stale = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: STALE_BASH_COMMAND }],
          },
        ],
      },
    };
    const { next } = mergeHookEntry(stale, SCRIPT);
    const hooksRoot = next.hooks as Record<string, unknown>;
    expect(hooksRoot.PreToolUse).toBeUndefined();
    expect(hooksRoot.UserPromptSubmit).toBeDefined();
  });

  it("is idempotent when the same command is already present", () => {
    const first = mergeHookEntry({}, SCRIPT);
    const second = mergeHookEntry(first.next, SCRIPT);
    expect(second.changed).toBe(false);
  });

  it("rewrites a stale UserPromptSubmit command when the script path drifts", () => {
    const stale = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [{ type: "command", command: 'node "/old/path/token-ninja/hook.cjs"' }],
          },
        ],
      },
    };
    const { next, changed } = mergeHookEntry(stale, SCRIPT);
    expect(changed).toBe(true);
    const ups = (next.hooks as Record<string, unknown>).UserPromptSubmit as Array<{
      hooks: Array<{ command: string }>;
    }>;
    expect(ups[0]!.hooks).toHaveLength(1);
    expect(ups[0]!.hooks[0]!.command).toBe(hookCommand(SCRIPT));
  });

  it("treats non-object input as empty config", () => {
    const { next, changed } = mergeHookEntry(null, SCRIPT);
    expect(changed).toBe(true);
    const ups = (next.hooks as Record<string, unknown>).UserPromptSubmit as unknown[];
    expect(ups).toHaveLength(1);
  });
});

describe("removeHookEntry", () => {
  it("removes our UserPromptSubmit hook and any legacy Bash hook together", () => {
    const existing = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: STALE_BASH_COMMAND },
              { type: "command", command: "bash unrelated.sh" },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: hookCommand(SCRIPT) },
              { type: "command", command: "node foreign.js" },
            ],
          },
        ],
      },
    };
    const { next, changed } = removeHookEntry(existing);
    expect(changed).toBe(true);
    const hooksRoot = next.hooks as Record<string, unknown>;
    const bash = (hooksRoot.PreToolUse as Array<{ matcher: string; hooks: Array<{ command: string }> }>).find(
      (g) => g.matcher === "Bash"
    )!;
    expect(bash.hooks.map((h) => h.command)).toEqual(["bash unrelated.sh"]);
    const ups = hooksRoot.UserPromptSubmit as Array<{ hooks: Array<{ command: string }> }>;
    expect(ups[0]!.hooks.map((h) => h.command)).toEqual(["node foreign.js"]);
  });

  it("drops now-empty groups and containers when ours was the only hook", () => {
    const existing = {
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: hookCommand(SCRIPT) }] },
        ],
      },
    };
    const { next, changed } = removeHookEntry(existing);
    expect(changed).toBe(true);
    expect((next as { hooks?: unknown }).hooks).toBeUndefined();
  });

  it("is a no-op when our hook isn't present", () => {
    const { changed } = removeHookEntry({
      hooks: { UserPromptSubmit: [{ hooks: [] }] },
    });
    expect(changed).toBe(false);
  });
});

describe("installHook / uninstallHook", () => {
  let dir = "";
  let path = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tn-hook-"));
    path = join(dir, "settings.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates settings.json when it doesn't exist", async () => {
    const r = await installHook({ path, scriptPath: SCRIPT });
    expect(r.changed).toBe(true);
    expect(r.created).toBe(true);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    const ups = parsed.hooks.UserPromptSubmit as Array<{ hooks: Array<{ command: string }> }>;
    expect(ups[0]!.hooks[0]!.command).toBe(hookCommand(SCRIPT));
  });

  it("migrates a legacy PreToolUse Bash token-ninja entry in a real file", async () => {
    await writeFile(
      path,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: STALE_BASH_COMMAND }],
            },
          ],
        },
      }),
      "utf8"
    );
    const r = await installHook({ path, scriptPath: SCRIPT });
    expect(r.changed).toBe(true);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    expect(parsed.hooks.PreToolUse).toBeUndefined();
    expect(parsed.hooks.UserPromptSubmit).toBeDefined();
    expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toBe(hookCommand(SCRIPT));
  });

  it("preserves other settings when merging", async () => {
    await writeFile(
      path,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Write|Edit", hooks: [{ type: "command", command: "node x.js" }] },
          ],
        },
        theme: "dark",
      }),
      "utf8"
    );
    const r = await installHook({ path, scriptPath: SCRIPT });
    expect(r.changed).toBe(true);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    expect(parsed.theme).toBe("dark");
    const pre = parsed.hooks.PreToolUse as Array<{ matcher: string }>;
    expect(pre.find((g) => g.matcher === "Write|Edit")).toBeTruthy();
    expect(parsed.hooks.UserPromptSubmit).toBeDefined();
  });

  it("is idempotent and backs up only once", async () => {
    await writeFile(path, JSON.stringify({ hooks: {} }), "utf8");
    const first = await installHook({ path, scriptPath: SCRIPT });
    expect(first.changed).toBe(true);
    expect(first.backupPath).toBe(`${path}.token-ninja.bak`);
    const second = await installHook({ path, scriptPath: SCRIPT });
    expect(second.changed).toBe(false);
    expect(second.backupPath).toBeNull();
  });

  it("skips safely when settings.json is malformed", async () => {
    await writeFile(path, "{not json", "utf8");
    const r = await installHook({ path, scriptPath: SCRIPT });
    expect(r.changed).toBe(false);
    expect(r.skippedReason).toMatch(/could not parse/);
    expect(await readFile(path, "utf8")).toBe("{not json");
  });

  it("dry-run does not write", async () => {
    const r = await installHook({ path, scriptPath: SCRIPT, dryRun: true });
    expect(r.changed).toBe(true);
    await expect(readFile(path, "utf8")).rejects.toBeTruthy();
  });

  it("uninstall removes our hook and leaves the rest of the file in place", async () => {
    await installHook({ path, scriptPath: SCRIPT });
    const before = JSON.parse(await readFile(path, "utf8"));
    before.theme = "dark";
    before.hooks.PreToolUse = [
      { matcher: "Write|Edit", hooks: [{ type: "command", command: "node x.js" }] },
    ];
    await writeFile(path, JSON.stringify(before), "utf8");

    const r = await uninstallHook({ path });
    expect(r.changed).toBe(true);
    const after = JSON.parse(await readFile(path, "utf8"));
    expect(after.theme).toBe("dark");
    expect(after.hooks?.UserPromptSubmit).toBeUndefined();
    const pre = (after.hooks?.PreToolUse ?? []) as Array<{ matcher: string }>;
    expect(pre.find((g) => g.matcher === "Write|Edit")).toBeTruthy();
  });

  it("uninstall is a no-op when settings.json is missing", async () => {
    const r = await uninstallHook({ path: join(dir, "does-not-exist.json") });
    expect(r.changed).toBe(false);
  });
});
