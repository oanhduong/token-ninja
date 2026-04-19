#!/usr/bin/env node
import { Command } from "commander";
import { runRouter } from "./router/index.js";
import { routeOnce } from "./router/route-once.js";
import { startMcpServer } from "./mcp/server.js";
import { runInit } from "./config/user-config.js";
import { runSetup, runUninstall } from "./setup/index.js";
import { listRules, testRule } from "./rules/loader.js";
import { printStats } from "./telemetry/stats.js";
import { generateShim } from "./adapters/index.js";
import { logger } from "./utils/logger.js";

const program = new Command();

program
  .name("ninja")
  .description("Save tokens on commands that don't need AI. Run deterministic commands locally, pass complex ones to your AI tool.")
  .version("0.2.0") // x-release-please-version
  .option("-v, --verbose", "verbose output", false)
  .option("--dry-run", "show what would run without executing", false)
  .option("--ai <tool>", "override AI tool fallback (claude|codex|cursor|aider|gemini|continue)")
  .option("--no-fallback", "do not fall back to AI tool; exit non-zero on miss")
  .option("--json", "machine-readable JSON output", false);

program
  .argument("[input...]", "command or natural-language prompt to route")
  .action(async (input: string[], opts) => {
    const joined = (input ?? []).join(" ").trim();
    if (!joined) {
      program.help();
      return;
    }
    const parent = program.opts();
    const merged = { ...parent, ...opts };
    const code = await runRouter(joined, merged);
    process.exit(code);
  });

program
  .command("mcp")
  .description("Start MCP stdio server exposing maybe_execute_locally")
  .action(async () => {
    await startMcpServer();
  });

program
  .command("route <input...>")
  .description(
    "Classify and execute a command with captured output; emit JSON (handled|unhandled). Used by the Claude Code UserPromptSubmit hook; safe for any integration that needs a one-shot router call without AI fallback."
  )
  .option("--cwd <dir>", "working directory (defaults to process.cwd())")
  .option(
    "--strict",
    "reject nl + regex matches (only exact/prefix count as handled); use from hooks to avoid intercepting conversational prompts"
  )
  .option(
    "--no-color",
    "disable forced ANSI colors in the executed command's output (default: on, so git/ls/etc. render colorized inside the Claude Code hook block)"
  )
  .action(
    async (
      input: string[],
      opts: { cwd?: string; strict?: boolean; color?: boolean }
    ) => {
      const command = input.join(" ").trim();
      const result = await routeOnce(command, {
        cwd: opts.cwd,
        strict: opts.strict === true,
        forceColor: opts.color !== false,
      });
      process.stdout.write(JSON.stringify(result) + "\n");
      process.exit(0);
    }
  );

program
  .command("setup")
  .description("Auto-install: detect AI tools, write shell shims into your rc file, register ninja mcp with MCP-capable clients, create config")
  .option("--shell <name>", "shell to target (bash|zsh|fish); auto-detect by default")
  .option("--tool <id>", "hook a specific tool (repeatable); default = all detected", collect, [])
  .option("--no-mcp", "skip auto-registering ninja mcp with Claude Code / Cursor / Claude Desktop")
  .option("--no-hook", "skip installing the Claude Code UserPromptSubmit hook")
  .option("--quiet", "minimal output", false)
  .action(
    async (
      opts: { shell?: string; tool: string[]; mcp: boolean; hook: boolean; quiet: boolean },
      cmd
    ) => {
      // The program-level `--dry-run` is hoisted by commander; merge so users
      // can pass it either before or after the subcommand name.
      const merged = cmd.optsWithGlobals();
      const code = await runSetup({
        shell: opts.shell,
        tools: opts.tool,
        dryRun: merged.dryRun === true,
        noMcp: opts.mcp === false,
        noHook: opts.hook === false,
        quiet: opts.quiet,
      });
      process.exit(code);
    }
  );

program
  .command("uninstall")
  .description("Remove the token-ninja managed block from your shell rc file")
  .option("--shell <name>", "shell to target (bash|zsh|fish); auto-detect by default")
  .option("--quiet", "minimal output", false)
  .action(async (opts: { shell?: string; quiet: boolean }) => {
    const code = await runUninstall({ shell: opts.shell, quiet: opts.quiet });
    process.exit(code);
  });

program
  .command("init")
  .description("Alias for `setup` (compatibility with earlier releases)")
  .action(async () => {
    await runInit();
  });

program
  .command("stats")
  .description("Show cumulative local-execution stats (tokens saved estimate)")
  .option("--reset", "reset all stats to zero")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    await printStats(opts);
  });

program
  .command("shim <tool>")
  .description("Generate a shell function that wraps the given AI tool (e.g. claude) through ninja")
  .option("--shell <name>", "shell (bash|zsh|fish); auto-detect by default")
  .action(async (tool: string, opts) => {
    const out = await generateShim(tool, opts.shell);
    process.stdout.write(out);
  });

const rules = program.command("rules").description("Inspect and test loaded rules");
rules
  .command("list")
  .description("List all loaded rules (built-in + user)")
  .option("--domain <name>", "filter by domain (e.g. git, npm, docker)")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    await listRules(opts);
  });
rules
  .command("test <input...>")
  .description("Dry-run a command through the classifier; show which rule would match")
  .action(async (input: string[]) => {
    await testRule(input.join(" "));
  });

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

program.parseAsync(process.argv).catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
