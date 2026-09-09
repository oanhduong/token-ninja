import { execa } from "execa";
import { loadConfig, configPath, DEFAULT_FALLBACK_COMMAND } from "../config/user-config.js";
import { ADAPTERS, detectAiTool } from "../adapters/index.js";
import { logger } from "../utils/logger.js";

/**
 * Environment variables the shell form of `fallback_command` reads from.
 * Values travel out-of-band instead of being spliced into the command text.
 */
const TOOL_ENV = "TOKEN_NINJA_AI_TOOL";
const INPUT_ENV = "TOKEN_NINJA_INPUT";

export interface FallbackOpts {
  aiOverride?: string;
  noFallback?: boolean;
  verbose?: boolean;
}

/**
 * Pass the input to the configured AI tool. Returns the AI tool's exit code.
 * If no AI tool is configured or found on PATH, we print an error and return
 * a non-zero code so the wrapper script fails loudly.
 *
 * SECURITY: the input arriving here has typically just been REJECTED by the
 * safety validator (`rm -rf …`, `sudo …`, `curl … | sh`), or matched no rule
 * at all. It is attacker-shaped by construction, so it never becomes part of
 * a command string. Two paths, neither of which interpolates it:
 *
 *   1. Default template — spawn the tool directly with the input as a single
 *      argv entry. No shell is involved, so there is nothing to inject into.
 *   2. Custom `fallback_command` — a shell is unavoidable (users put pipes
 *      and flags in there), so the placeholders expand to *references*
 *      (`"$TOKEN_NINJA_INPUT"`) and the values reach the child through its
 *      environment. POSIX shells do not rescan the result of a parameter
 *      expansion, so `$(…)`, backticks and quotes inside the value stay
 *      literal.
 *
 * Quoting the values into the command string would also work, but only for
 * as long as the quoting function is perfect on every platform — and the
 * first version was not, because `String.replace` reinterpreted `$'` in the
 * replacement text. Keeping the value out of the string removes that whole
 * class of bug instead of patching instances of it.
 *
 * Either way `echo 'hi'; touch /tmp/pwned` reaches the AI tool as one opaque
 * argument instead of being executed.
 */
export async function fallbackToAi(input: string, opts: FallbackOpts): Promise<number> {
  if (opts.noFallback) {
    logger.error(
      `no rule matched and --no-fallback was set; input was: ${input}\n` +
        `hint: drop --no-fallback to pass the command through to your AI tool, ` +
        `or add a rule covering it (see: ninja rules test "${input}")`
    );
    return 2;
  }

  const config = await loadConfig();
  const tool = opts.aiOverride ?? config.default_ai_tool ?? (await detectAiTool());

  if (!tool) {
    const supported = ADAPTERS.filter((a) => a.bin).map((a) => a.id).join(", ");
    logger.error(
      `no AI tool detected on PATH.\n` +
        `  supported: ${supported}\n` +
        `  fix:\n` +
        `    1. install one of the tools above, then run: ninja setup\n` +
        `    2. OR set default_ai_tool: <name> in ${configPath()}\n` +
        `    3. OR pass --ai <name> for this invocation`
    );
    return 127;
  }

  logger.debug(`fallback → ${tool}: ${input}`);

  const template = (config.fallback_command ?? DEFAULT_FALLBACK_COMMAND).trim();
  // cmd.exe expands %VAR% inside double quotes and offers no reliable way to
  // quote a value containing `"`, so the env-reference form below is not
  // portable to it. Windows is unsupported anyway (README → Platform
  // support); rather than emit a command we cannot reason about, use the
  // shell-free path there and say so.
  const shellUsable = process.platform !== "win32";

  try {
    let child;
    if (template === DEFAULT_FALLBACK_COMMAND || !shellUsable) {
      if (template !== DEFAULT_FALLBACK_COMMAND) {
        logger.warn(
          `custom fallback_command is not supported on Windows; ` +
            `invoking ${tool} directly instead`
        );
      }
      // No shell: the input cannot be re-parsed as shell syntax.
      child = execa(tool, [input], { stdio: "inherit", reject: false });
    } else {
      // The placeholders expand to env *references*, never to the values.
      // Function replacements, not strings: a string replacement interprets
      // `$&`, `$'`, "$`" and `$1`, which would corrupt even a constant.
      const rendered = template
        .replace(/\{\{\s*tool\s*\}\}/g, () => `"$${TOOL_ENV}"`)
        .replace(/\{\{\s*input\s*\}\}/g, () => `"$${INPUT_ENV}"`);
      child = execa(rendered, {
        shell: true,
        stdio: "inherit",
        reject: false,
        env: { ...process.env, [TOOL_ENV]: tool, [INPUT_ENV]: input },
      });
    }
    const result = await child;
    return typeof result.exitCode === "number" ? result.exitCode : 0;
  } catch (err) {
    logger.error(
      `failed to invoke ${tool}: ${(err as Error).message}\n` +
        `hint: verify ${tool} is on your PATH (\`which ${tool}\`), or run \`ninja doctor\``
    );
    return 1;
  }
}
