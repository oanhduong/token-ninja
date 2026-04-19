import { loadRules } from "../rules/loader.js";
import { classify } from "./classifier.js";
import { execShell } from "./executor.js";
import { validate } from "../safety/validator.js";
import {
  estimateTokensSaved,
  recordFallback,
  recordHit,
} from "../telemetry/stats.js";

export interface RouteOnceOpts {
  cwd?: string;
  /**
   * Require a high-confidence match. When true, only `exact` and `prefix`
   * classifier hits are accepted; `regex` and `nl` are rejected with
   * reason:"low_confidence". Used by the UserPromptSubmit hook so
   * conversational inputs like "can you explain git rebase?" never
   * accidentally short-circuit the model.
   */
  strict?: boolean;
  /**
   * Force ANSI color output from the executed command. Used by the
   * UserPromptSubmit hook so git/ls/etc. render in their usual colors
   * inside Claude Code's (yellow) block-reason. MCP callers leave this
   * off to avoid embedding escape codes in tokens sent to the model.
   */
  forceColor?: boolean;
}

export type RouteOnceResult =
  | {
      handled: true;
      stdout: string;
      stderr: string;
      exit_code: number;
      rule_id: string;
      matched_via: string;
      tokens_saved_estimate: number;
    }
  | {
      handled: false;
      reason: "empty_command" | "safety_block" | "no_match" | "low_confidence";
      detail?: string;
    };

/**
 * One-shot classify-and-execute. Captures stdout/stderr without streaming
 * (suitable for programmatic callers: MCP tool handler, Claude Code
 * PreToolUse hook). Records telemetry. Never falls back to an AI tool.
 */
export async function routeOnce(
  command: string,
  opts: RouteOnceOpts = {}
): Promise<RouteOnceResult> {
  if (!command.trim()) {
    return { handled: false, reason: "empty_command" };
  }

  const safety = validate(command);
  if (!safety.allowed) {
    await recordFallback("safety_block");
    return {
      handled: false,
      reason: "safety_block",
      detail: safety.patternId,
    };
  }

  const cwd = opts.cwd ?? process.cwd();
  const rules = await loadRules();
  const match = await classify(command, rules, { cwd });
  if (!match) {
    await recordFallback("no_match");
    return { handled: false, reason: "no_match" };
  }

  if (opts.strict && match.matchedVia !== "exact" && match.matchedVia !== "prefix") {
    await recordFallback("low_confidence");
    return { handled: false, reason: "low_confidence", detail: match.matchedVia };
  }

  const safety2 = validate(match.command);
  if (!safety2.allowed) {
    await recordFallback("safety_block");
    return {
      handled: false,
      reason: "safety_block",
      detail: safety2.patternId,
    };
  }

  const result = await execShell(match.command, {
    cwd,
    captureOnly: true,
    forceColor: opts.forceColor === true,
  });
  const tokens = estimateTokensSaved(command, result, match.rule);
  await recordHit(match.rule, command, result);

  return {
    handled: true,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exitCode,
    rule_id: match.rule.id,
    matched_via: match.matchedVia,
    tokens_saved_estimate: tokens,
  };
}
