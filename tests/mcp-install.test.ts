import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MCP_SERVER_ENTRY,
  TOKEN_NINJA_KEY,
  installMcp,
  mergeMcpEntry,
  removeMcpEntry,
  uninstallMcp,
} from "../src/setup/mcp-install.js";
import type { McpClientTarget } from "../src/setup/mcp-install.js";

describe("mergeMcpEntry", () => {
  it("adds a token-ninja entry into an empty config", () => {
    const { next, changed } = mergeMcpEntry({}, "mcpServers");
    expect(changed).toBe(true);
    const servers = next.mcpServers as Record<string, unknown>;
    expect(servers[TOKEN_NINJA_KEY]).toEqual(MCP_SERVER_ENTRY);
  });

  it("preserves other top-level keys and other MCP servers", () => {
    const existing = {
      editor: { theme: "dark" },
      mcpServers: {
        "my-other-server": { command: "node", args: ["srv.js"] },
      },
    };
    const { next, changed } = mergeMcpEntry(existing, "mcpServers");
    expect(changed).toBe(true);
    expect((next as typeof existing).editor).toEqual({ theme: "dark" });
    const servers = next.mcpServers as Record<string, unknown>;
    expect(servers["my-other-server"]).toEqual({ command: "node", args: ["srv.js"] });
    expect(servers[TOKEN_NINJA_KEY]).toEqual(MCP_SERVER_ENTRY);
  });

  it("is idempotent when the same entry already exists", () => {
    const first = mergeMcpEntry({}, "mcpServers");
    const second = mergeMcpEntry(first.next, "mcpServers");
    expect(second.changed).toBe(false);
  });

  it("updates the entry if the command drifted", () => {
    const stale = {
      mcpServers: {
        [TOKEN_NINJA_KEY]: { command: "some-old-bin", args: ["mcp"] },
      },
    };
    const { next, changed } = mergeMcpEntry(stale, "mcpServers");
    expect(changed).toBe(true);
    const servers = next.mcpServers as Record<string, unknown>;
    expect(servers[TOKEN_NINJA_KEY]).toEqual(MCP_SERVER_ENTRY);
  });

  it("rebuilds mcpServers when the existing value has the wrong shape", () => {
    const broken = { mcpServers: "not-an-object" };
    const { next, changed } = mergeMcpEntry(broken, "mcpServers");
    expect(changed).toBe(true);
    const servers = next.mcpServers as Record<string, unknown>;
    expect(servers[TOKEN_NINJA_KEY]).toEqual(MCP_SERVER_ENTRY);
  });

  it("treats non-object input as an empty config", () => {
    const { next, changed } = mergeMcpEntry(null, "mcpServers");
    expect(changed).toBe(true);
    expect(next.mcpServers).toBeDefined();
  });
});

describe("removeMcpEntry", () => {
  it("removes our entry and leaves others intact", () => {
    const existing = {
      mcpServers: {
        [TOKEN_NINJA_KEY]: { command: "ninja", args: ["mcp"] },
        other: { command: "node" },
      },
    };
    const { next, changed } = removeMcpEntry(existing, "mcpServers");
    expect(changed).toBe(true);
    const servers = next.mcpServers as Record<string, unknown>;
    expect(servers[TOKEN_NINJA_KEY]).toBeUndefined();
    expect(servers.other).toEqual({ command: "node" });
  });

  it("is a no-op when the entry is absent", () => {
    const { changed } = removeMcpEntry({ mcpServers: {} }, "mcpServers");
    expect(changed).toBe(false);
  });
});

describe("installMcp", () => {
  let dir = "";
  let target: McpClientTarget;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tn-mcp-"));
    target = {
      id: "claude-code",
      label: "Claude Code (test)",
      path: join(dir, ".claude.json"),
      serversKey: "mcpServers",
    };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the config file when it doesn't exist", async () => {
    const results = await installMcp({ targets: [target] });
    expect(results[0]!.changed).toBe(true);
    expect(results[0]!.created).toBe(true);
    const raw = await readFile(target.path, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.mcpServers[TOKEN_NINJA_KEY]).toEqual(MCP_SERVER_ENTRY);
  });

  it("preserves unrelated keys in an existing file", async () => {
    await writeFile(
      target.path,
      JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } }, null, 2),
      "utf8"
    );
    const results = await installMcp({ targets: [target] });
    expect(results[0]!.changed).toBe(true);
    const parsed = JSON.parse(await readFile(target.path, "utf8"));
    expect(parsed.theme).toBe("dark");
    expect(parsed.mcpServers.other).toEqual({ command: "x" });
    expect(parsed.mcpServers[TOKEN_NINJA_KEY]).toEqual(MCP_SERVER_ENTRY);
  });

  it("is idempotent across repeated runs and backs up only once", async () => {
    await writeFile(target.path, JSON.stringify({ mcpServers: {} }), "utf8");
    const first = await installMcp({ targets: [target] });
    expect(first[0]!.changed).toBe(true);
    expect(first[0]!.backupPath).toBe(`${target.path}.token-ninja.bak`);
    const second = await installMcp({ targets: [target] });
    expect(second[0]!.changed).toBe(false);
    expect(second[0]!.backupPath).toBeNull();
  });

  it("skips safely when the file is malformed", async () => {
    await writeFile(target.path, "{not json", "utf8");
    const results = await installMcp({ targets: [target] });
    expect(results[0]!.changed).toBe(false);
    expect(results[0]!.skippedReason).toMatch(/could not parse/);
    // File is untouched
    expect(await readFile(target.path, "utf8")).toBe("{not json");
  });

  it("dry-run does not write but reports intended change", async () => {
    const results = await installMcp({ targets: [target], dryRun: true });
    expect(results[0]!.changed).toBe(true);
    await expect(readFile(target.path, "utf8")).rejects.toBeTruthy();
  });

  it("creates parent directories when needed", async () => {
    const nested = {
      ...target,
      path: join(dir, "does", "not", "exist", ".claude.json"),
    };
    const results = await installMcp({ targets: [nested] });
    expect(results[0]!.changed).toBe(true);
    const parsed = JSON.parse(await readFile(nested.path, "utf8"));
    expect(parsed.mcpServers[TOKEN_NINJA_KEY]).toEqual(MCP_SERVER_ENTRY);
  });
});

describe("uninstallMcp", () => {
  let dir = "";
  let target: McpClientTarget;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tn-mcp-u-"));
    target = {
      id: "claude-code",
      label: "Claude Code (test)",
      path: join(dir, ".claude.json"),
      serversKey: "mcpServers",
    };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is a no-op when the config file is missing", async () => {
    const results = await uninstallMcp({ targets: [target] });
    expect(results[0]!.changed).toBe(false);
  });

  it("removes the token-ninja entry but keeps the file and other servers", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      target.path,
      JSON.stringify({
        mcpServers: {
          [TOKEN_NINJA_KEY]: { command: "ninja", args: ["mcp"] },
          other: { command: "node" },
        },
      }),
      "utf8"
    );
    const results = await uninstallMcp({ targets: [target] });
    expect(results[0]!.changed).toBe(true);
    const parsed = JSON.parse(await readFile(target.path, "utf8"));
    expect(parsed.mcpServers[TOKEN_NINJA_KEY]).toBeUndefined();
    expect(parsed.mcpServers.other).toEqual({ command: "node" });
  });
});
