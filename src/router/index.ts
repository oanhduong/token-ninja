import { loadRules } from "../rules/loader.js";
import { classify } from "./classifier.js";
import { execShell } from "./executor.js";
import { fallbackToAi } from "./fallback.js";
import { validate } from "../safety/validator.js";
import { recordHit, recordFallback } from "../telemetry/stats.js";
import { logger } from "../utils/logger.js";

export interface RouterOpts {
  verbose?: boolean;
  dryRun?: boolean;
  ai?: string;
  fallback?: boolean;
  json?: boolean;
}

export async function runRouter(input: string, opts: RouterOpts): Promise<number> {
  if (opts.verbose) logger.setVerbose(true);

  const safety = validate(input);
  if (!safety.allowed) {
    logger.debug(`safety block (${safety.patternId}): ${safety.reason} — falling back to AI`);
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({ handled: false, reason: "safety_block", detail: safety }) + "\n"
      );
    }
    await recordFallback("safety_block");
    return fallbackToAi(input, {
      aiOverride: opts.ai,
      noFallback: opts.fallback === false,
      verbose: opts.verbose,
    });
  }

  const rules = await loadRules();
  const match = await classify(input, rules, { cwd: process.cwd() });

  if (!match) {
    logger.debug(`no rule matched — falling back to AI`);
    if (opts.json) {
      process.stdout.write(JSON.stringify({ handled: false, reason: "no_match" }) + "\n");
    }
    await recordFallback("no_match");
    return fallbackToAi(input, {
      aiOverride: opts.ai,
      noFallback: opts.fallback === false,
      verbose: opts.verbose,
    });
  }

  // Re-validate the resolved command, in case a template expansion
  // produced something dangerous (defensive — rules shouldn't do this).
  const safety2 = validate(match.command);
  if (!safety2.allowed) {
    logger.warn(
      `resolved command blocked by safety (${safety2.patternId}); falling back to AI`
    );
    await recordFallback("safety_block");
    return fallbackToAi(input, {
      aiOverride: opts.ai,
      noFallback: opts.fallback === false,
      verbose: opts.verbose,
    });
  }

  if (opts.dryRun) {
    process.stdout.write(
      `[dry-run] matched ${match.rule.id} (${match.matchedVia}) → ${match.command}\n`
    );
    return 0;
  }

  logger.debug(`match ${match.rule.id} via ${match.matchedVia} → ${match.command}`);
  const result = await execShell(match.command);
  await recordHit(match.rule, input, result);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        handled: true,
        rule_id: match.rule.id,
        matched_via: match.matchedVia,
        command: match.command,
        exit_code: result.exitCode,
        duration_ms: result.durationMs,
      }) + "\n"
    );
  }
  return result.exitCode;
}
