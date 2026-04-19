import { execa } from "execa";
import { loadConfig } from "../config/user-config.js";
import { detectAiTool } from "../adapters/index.js";
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
    logger.error(`no rule matched and --no-fallback was set; input was: ${input}`);
    return 2;
  }

  const config = await loadConfig();
  const tool = opts.aiOverride ?? config.default_ai_tool ?? (await detectAiTool());

  if (!tool) {
    logger.error(
      "no AI tool detected on PATH. install one of: claude, codex, cursor-agent, aider, gemini, continue — or set default_ai_tool in ~/.config/token-ninja/config.yaml"
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
    logger.error(`failed to invoke ${tool}: ${(err as Error).message}`);
    return 1;
  }
}
