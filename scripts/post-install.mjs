#!/usr/bin/env node
// Postinstall hook for `npm install -g token-ninja`.
//
// It prints how to finish the install. It does NOT run `ninja setup` on its
// own, because setup edits the user's shell rc file, registers MCP servers
// and installs a Claude Code hook — side effects outside the package
// directory that nobody consented to by typing `npm install`. Many orgs also
// run installs with `--ignore-scripts`, so a package that only works after a
// postinstall ran is a package that silently half-works there.
//
// Opt in to the old behaviour with TOKEN_NINJA_AUTO_SETUP=1.
//
// Design goals:
//   * Never fail the install (exit 0 always).
//   * Stay silent for dependency/local installs — only speak up for a global
//     install a human just typed.
//   * Idempotent: safe to run repeatedly.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function shouldSkip() {
  const env = process.env;
  if (env.TOKEN_NINJA_SKIP_POSTINSTALL === "1") return "TOKEN_NINJA_SKIP_POSTINSTALL=1";
  if (env.CI) return "CI environment detected";
  if (env.NODE_ENV === "test") return "NODE_ENV=test";
  // npm sets npm_config_global=true for `npm i -g`. For dep installs and
  // `npm install` in the project itself it's unset/false — printing a setup
  // banner there would be noise.
  if (env.npm_config_global !== "true") return "not a global install";
  return null;
}

function printNextSteps() {
  process.stdout.write(
    [
      "",
      "token-ninja installed. One more step:",
      "",
      "  ninja setup     # writes shell shims, registers MCP, installs the Claude Code hook",
      "  ninja doctor    # verify the install",
      "",
      "`ninja setup` is not run automatically because it edits your shell rc file.",
      "",
    ].join("\n")
  );
}

async function main() {
  const reason = shouldSkip();
  if (reason) {
    if (process.env.TOKEN_NINJA_POSTINSTALL_DEBUG) {
      process.stdout.write(`token-ninja postinstall skipped: ${reason}\n`);
    }
    return;
  }

  if (process.env.TOKEN_NINJA_AUTO_SETUP !== "1") {
    printNextSteps();
    return;
  }

  const cliPath = join(__dirname, "..", "dist", "cli.js");
  if (!existsSync(cliPath)) {
    // Happens during `npm install` from git before build. Safe to skip.
    return;
  }

  try {
    const { runSetup } = await import(join(__dirname, "..", "dist", "setup", "index.js"));
    await runSetup({ quiet: false });
  } catch (err) {
    // Never fail the install. Surface a hint; don't throw.
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      `token-ninja: automatic setup skipped (${msg}). Run \`ninja setup\` to finish.\n`
    );
  }
}

main().catch(() => {
  // absolute safety net
  process.exit(0);
});
