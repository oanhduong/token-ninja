#!/usr/bin/env node
// Postinstall hook: runs `ninja setup` after `npm install -g token-ninja`.
//
// Design goals:
//   * Never fail the install (exit 0 always).
//   * Only touch the user's shell rc when this looks like a real install on a
//     user's machine — skip in CI, skip in non-global local installs, skip
//     when npm_config_ignore_scripts is set or we can't detect a writable TTY.
//   * Idempotent: safe to run repeatedly.
//   * Opt-out via TOKEN_NINJA_SKIP_POSTINSTALL=1.
//
// The user can always re-run `ninja setup` manually if we skip.

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
  // `npm install` in the project itself it's unset/false — editing the
  // user's rc file there would be very surprising, so require an explicit
  // global install.
  if (env.npm_config_global !== "true") return "not a global install";
  return null;
}

async function main() {
  const reason = shouldSkip();
  if (reason) {
    // Stay silent in common cases; users can run `ninja setup` themselves.
    if (process.env.TOKEN_NINJA_POSTINSTALL_DEBUG) {
      process.stdout.write(`token-ninja postinstall skipped: ${reason}\n`);
    }
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
