import { execa } from "execa";
import { loadConfig, configPath } from "../config/user-config.js";
import { ADAPTERS, detectAiTool } from "../adapters/index.js";
import { logger } from "../utils/logger.js";

export interface FallbackOpts {
  aiOverride?: string;
  noFallback?: boolean;
  verbose?: boolean;
}

/**
 * Pass the input to the configured AI tool. Returns the AI tool's exit code.
 * If no AI tool is configured or found on PATH, we print an error and return
 * a non-zero code so the wrapper script fails loudly.
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

  const template = config.fallback_command ?? "{{tool}} {{input}}";
  const rendered = template
    .replace(/\{\{\s*tool\s*\}\}/g, tool)
    .replace(/\{\{\s*input\s*\}\}/g, input);

  try {
    const child = execa(rendered, {
      shell: true,
      stdio: "inherit",
      reject: false,
    });
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
