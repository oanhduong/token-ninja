import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { configDir, loadConfig } from "../config/user-config.js";
import type { Rule } from "../rules/types.js";
import type { ExecResult } from "../router/executor.js";
import { logger } from "../utils/logger.js";
import { join } from "node:path";

interface StatsFile {
  version: 1;
  total_hits: number;
  total_fallbacks: number;
  total_safety_blocks: number;
  total_tokens_saved_estimate: number;
  total_bytes_produced: number;
  total_duration_ms: number;
  by_rule: Record<
    string,
    { count: number; tokens_saved_estimate: number; last_used: string }
  >;
  by_domain: Record<string, number>;
  fallback_reasons: Record<string, number>;
  first_run: string;
  last_run: string;
}

function emptyStats(): StatsFile {
  const now = new Date().toISOString();
  return {
    version: 1,
    total_hits: 0,
    total_fallbacks: 0,
    total_safety_blocks: 0,
    total_tokens_saved_estimate: 0,
    total_bytes_produced: 0,
    total_duration_ms: 0,
    by_rule: {},
    by_domain: {},
    fallback_reasons: {},
    first_run: now,
    last_run: now,
  };
}

function statsPath(): string {
  return join(configDir(), "stats.json");
}

/**
 * Read the stats file. A missing file is normal (first run). A file that
 * exists but will not parse is NOT normal — it means a previous write was
 * interrupted, or two processes raced. Returning fresh counters silently
 * would erase the user's whole history, so we move the bad file aside first
 * and say so.
 */
async function readStats(): Promise<StatsFile> {
  const path = statsPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return emptyStats();
  }
  try {
    const parsed = JSON.parse(raw) as StatsFile;
    if (parsed.version !== 1) return emptyStats();
    return parsed;
  } catch (err) {
    const backup = `${path}.corrupt-${Date.now()}`;
    try {
      await rename(path, backup);
      logger.warn(
        `stats file was unreadable (${(err as Error).message}); ` +
          `moved to ${backup} and started fresh counters`
      );
    } catch {
      /* best effort — never block the command the user actually ran */
    }
    return emptyStats();
  }
}

/**
 * Write the stats file atomically: a temp file in the same directory, then a
 * rename. `rename(2)` is atomic within a filesystem, so a reader never sees a
 * half-written file even when the shim, the Claude Code hook and the MCP
 * server all record a hit at the same moment. The temp name must be unique
 * per CALL, not per process: two awaits in flight inside one process would
 * otherwise share a scratch file and the second rename would find it already
 * moved away.
 */
let tmpCounter = 0;

async function writeStats(s: StatsFile): Promise<void> {
  const path = statsPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${tmpCounter++}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Telemetry is opt-out via `stats.enabled: false` in config.yaml. */
async function statsEnabled(): Promise<boolean> {
  const cfg = await loadConfig();
  return cfg.stats?.enabled !== false;
}

/**
 * Estimate how many tokens we avoided by not round-tripping through the AI.
 * Heuristic: ~4 chars per token, we count the user's input plus the command
 * output plus a typical system prompt / response overhead (~400 tokens).
 */
export function estimateTokensSaved(input: string, result: ExecResult, rule: Rule): number {
  if (typeof rule.tokens_saved_estimate === "number") return rule.tokens_saved_estimate;
  const inputTokens = Math.ceil(input.length / 4);
  const outputTokens = Math.ceil((result.stdout.length + result.stderr.length) / 4);
  const overhead = 400; // typical system prompt + response wrapping
  return inputTokens + outputTokens + overhead;
}

export async function recordHit(
  rule: Rule,
  input: string,
  result: ExecResult
): Promise<void> {
  if (!(await statsEnabled())) return;
  const s = await readStats();
  const tokens = estimateTokensSaved(input, result, rule);
  s.total_hits += 1;
  s.total_tokens_saved_estimate += tokens;
  s.total_bytes_produced += result.stdout.length + result.stderr.length;
  s.total_duration_ms += result.durationMs;
  const prev = s.by_rule[rule.id] ?? {
    count: 0,
    tokens_saved_estimate: 0,
    last_used: new Date(0).toISOString(),
  };
  prev.count += 1;
  prev.tokens_saved_estimate += tokens;
  prev.last_used = new Date().toISOString();
  s.by_rule[rule.id] = prev;
  s.by_domain[rule.domain] = (s.by_domain[rule.domain] ?? 0) + 1;
  s.last_run = new Date().toISOString();
  await writeStats(s);
}

export async function recordFallback(reason: string): Promise<void> {
  if (!(await statsEnabled())) return;
  const s = await readStats();
  s.total_fallbacks += 1;
  if (reason === "safety_block") s.total_safety_blocks += 1;
  s.fallback_reasons[reason] = (s.fallback_reasons[reason] ?? 0) + 1;
  s.last_run = new Date().toISOString();
  await writeStats(s);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export async function printStats(opts: { reset?: boolean; json?: boolean }): Promise<void> {
  if (opts.reset) {
    await writeStats(emptyStats());
    process.stdout.write("stats reset.\n");
    return;
  }
  const s = await readStats();
  if (opts.json) {
    process.stdout.write(JSON.stringify(s, null, 2) + "\n");
    return;
  }
  const total = s.total_hits + s.total_fallbacks;
  const hitRate = total === 0 ? 0 : (s.total_hits / total) * 100;

  const top = Object.entries(s.by_rule)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10);

  process.stdout.write("\n  token-ninja — local-execution stats\n");
  process.stdout.write("  " + "─".repeat(52) + "\n");
  process.stdout.write(`  first run              : ${s.first_run}\n`);
  process.stdout.write(`  last run               : ${s.last_run}\n`);
  process.stdout.write(`  total local hits       : ${fmt(s.total_hits)}\n`);
  process.stdout.write(`  total AI fallbacks     : ${fmt(s.total_fallbacks)}\n`);
  process.stdout.write(`  safety blocks          : ${fmt(s.total_safety_blocks)}\n`);
  process.stdout.write(`  local-hit rate         : ${hitRate.toFixed(1)}%\n`);
  process.stdout.write(`  est. tokens saved      : ${fmt(s.total_tokens_saved_estimate)}\n`);
  process.stdout.write(`  total bytes produced   : ${fmt(s.total_bytes_produced)}\n`);

  if (top.length) {
    process.stdout.write("\n  top rules:\n");
    for (const [id, v] of top) {
      process.stdout.write(
        `    ${id.padEnd(38)} ${String(v.count).padStart(6)} hits   ~${fmt(v.tokens_saved_estimate)} tokens\n`
      );
    }
  }

  if (Object.keys(s.fallback_reasons).length) {
    process.stdout.write("\n  fallback reasons:\n");
    for (const [reason, count] of Object.entries(s.fallback_reasons)) {
      process.stdout.write(`    ${reason.padEnd(20)} ${fmt(count)}\n`);
    }
  }
  process.stdout.write("\n");
}
