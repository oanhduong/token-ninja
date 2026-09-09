#!/usr/bin/env node
/**
 * Count builtin rules, domains and tests, print a compact summary, and (with
 * --sync) rewrite the "736 rules across 46 domains" / "312 tests across 21
 * files"-style claims in README.md, CONTRIBUTING.md and CLAUDE.md so they
 * stay true.
 *
 * Test counts come from `vitest list --json`, which collects the suite
 * without running it. Counting `it(` with a regex would undercount every
 * `it.each` and every test generated in a loop — this repo's static count is
 * 285 against a real 389.
 *
 * Usage:
 *   node scripts/rule-stats.mjs                  # print totals
 *   node scripts/rule-stats.mjs --json           # machine-readable
 *   node scripts/rule-stats.mjs --sync           # update docs in place
 *   node scripts/rule-stats.mjs --check          # exit 1 if docs are stale
 *   node scripts/rule-stats.mjs --no-test-count  # skip the vitest collection
 */

import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const builtinDir = join(root, "src", "rules", "builtin");

const DOC_FILES = [
  join(root, "README.md"),
  join(root, "CONTRIBUTING.md"),
  join(root, "CLAUDE.md"),
];

const execFileAsync = promisify(execFile);

/**
 * Ask vitest to collect (not run) the suite and report how many tests and
 * files it found. Returns null when the collection fails — a doc script must
 * never be the reason a build breaks.
 */
async function loadTestCounts() {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [join(root, "node_modules", "vitest", "vitest.mjs"), "list", "--json"],
      { cwd: root, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CI: "true" } }
    );
    const entries = JSON.parse(stdout);
    if (!Array.isArray(entries)) return null;
    return { tests: entries.length, testFiles: new Set(entries.map((e) => e.file)).size };
  } catch {
    return null;
  }
}

async function loadBuiltin() {
  const files = (await readdir(builtinDir)).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml")
  );
  const byDomain = new Map();
  const rules = [];
  for (const f of files) {
    const raw = await readFile(join(builtinDir, f), "utf8");
    const parsed = parseYaml(raw);
    if (!parsed || !Array.isArray(parsed.rules)) continue;
    for (const r of parsed.rules) {
      const domain = r.domain ?? parsed.domain ?? "uncategorized";
      rules.push({ ...r, domain });
      byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
    }
  }
  return { files, rules, byDomain };
}

// Matches phrases like:
//   "736 rules across 46 domains"
//   "736 production rules across 46 domains"
//   "472+ production rules across 29 domains"
//   "736 production-grade examples across 46 domains"
// Case-insensitive so "Rules"/"Domains" also match.
const COUNT_RE =
  /(\d{2,5})\+?(\s+(?:built-in|production|production-grade)?\s*(?:rules?|examples?)\s+across\s+)(\d{1,4})(\s+(?:tool\s+)?domains?)/gi;

// Matches phrases like:
//   "312 tests across 21 files"
//   "312 tests across 21 test files"
const TESTS_ACROSS_RE = /(\d{2,5})(\s+tests?\s+across\s+)(\d{1,4})(\s+(?:test\s+)?files?)/gi;
// Matches the reversed form used in the source-layout comment:
//   "20 test files, 268 tests"
const FILES_THEN_TESTS_RE = /(\d{1,4})(\s+test\s+files?,\s+)(\d{2,5})(\s+tests)/gi;
// Matches the command annotations:
//   "npm test   # vitest run, 218 tests"
//   "npm test   # vitest run (all 268 tests)"
const VITEST_RUN_RE = /(vitest run[^\n]{0,20}?)(\d{2,5})(\s+tests)/gi;

function rewrite(content, rules, domains, tests) {
  let changed = false;
  const mark = (full, replacement) => {
    if (replacement !== full) changed = true;
    return replacement;
  };

  let next = content.replace(COUNT_RE, (full, r, mid, d, tail) =>
    mark(full, `${rules}${mid}${domains}${tail}`)
  );

  if (tests) {
    next = next
      .replace(TESTS_ACROSS_RE, (full, _n, mid, _f, tail) =>
        mark(full, `${tests.tests}${mid}${tests.testFiles}${tail}`)
      )
      .replace(FILES_THEN_TESTS_RE, (full, _f, mid, _n, tail) =>
        mark(full, `${tests.testFiles}${mid}${tests.tests}${tail}`)
      )
      .replace(VITEST_RUN_RE, (full, head, _n, tail) =>
        mark(full, `${head}${tests.tests}${tail}`)
      );
  }

  return { next, changed };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const { files, rules, byDomain } = await loadBuiltin();
  const totalRules = rules.length;
  const totalDomains = byDomain.size;
  const tests = args.has("--no-test-count") ? null : await loadTestCounts();

  if (args.has("--json")) {
    const by = Object.fromEntries(
      [...byDomain.entries()].sort((a, b) => b[1] - a[1])
    );
    console.log(
      JSON.stringify(
        {
          files: files.length,
          rules: totalRules,
          domains: totalDomains,
          tests: tests?.tests ?? null,
          testFiles: tests?.testFiles ?? null,
          by,
        },
        null,
        2
      )
    );
    return;
  }

  if (args.has("--sync") || args.has("--check")) {
    const stale = [];
    for (const p of DOC_FILES) {
      let raw;
      try {
        raw = await readFile(p, "utf8");
      } catch {
        continue;
      }
      const { next, changed } = rewrite(raw, totalRules, totalDomains, tests);
      if (!changed) continue;
      stale.push(p);
      if (args.has("--sync")) {
        await writeFile(p, next, "utf8");
        console.log(`[rule-stats] updated ${p}`);
      }
    }
    if (args.has("--check")) {
      if (stale.length > 0) {
        console.error(
          `[rule-stats] out-of-date counts in:\n  ${stale.join("\n  ")}\n` +
            `run: node scripts/rule-stats.mjs --sync`
        );
        process.exit(1);
      }
      const suffix = tests ? ` / ${tests.tests} tests / ${tests.testFiles} test files` : "";
      console.log(
        `[rule-stats] docs in sync (${totalRules} rules / ${totalDomains} domains${suffix})`
      );
    }
    return;
  }

  console.log(`files   : ${files.length}`);
  console.log(`rules   : ${totalRules}`);
  console.log(`domains : ${totalDomains}`);
  if (tests) {
    console.log(`tests   : ${tests.tests} in ${tests.testFiles} files`);
  }
  const top = [...byDomain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log("\ntop domains:");
  for (const [d, n] of top) console.log(`  ${d.padEnd(22)} ${String(n).padStart(4)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
