#!/usr/bin/env node
/**
 * Count builtin rules and domains, print a compact summary, and (with --sync)
 * rewrite the "736 rules across 46 domains"-style claims in README.md,
 * CONTRIBUTING.md and CLAUDE.md so they stay true.
 *
 * Usage:
 *   node scripts/rule-stats.mjs          # print totals
 *   node scripts/rule-stats.mjs --json   # machine-readable
 *   node scripts/rule-stats.mjs --sync   # update docs in place
 *   node scripts/rule-stats.mjs --check  # exit 1 if docs are out of date
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
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

function rewrite(content, rules, domains) {
  let changed = false;
  const next = content.replace(COUNT_RE, (full, r, mid, d, tail) => {
    const replacement = `${rules}${mid}${domains}${tail}`;
    if (replacement !== full) changed = true;
    return replacement;
  });
  return { next, changed };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const { files, rules, byDomain } = await loadBuiltin();
  const totalRules = rules.length;
  const totalDomains = byDomain.size;

  if (args.has("--json")) {
    const by = Object.fromEntries(
      [...byDomain.entries()].sort((a, b) => b[1] - a[1])
    );
    console.log(
      JSON.stringify({ files: files.length, rules: totalRules, domains: totalDomains, by }, null, 2)
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
      const { next, changed } = rewrite(raw, totalRules, totalDomains);
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
      console.log(`[rule-stats] docs in sync (${totalRules} rules / ${totalDomains} domains)`);
    }
    return;
  }

  console.log(`files   : ${files.length}`);
  console.log(`rules   : ${totalRules}`);
  console.log(`domains : ${totalDomains}`);
  const top = [...byDomain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log("\ntop domains:");
  for (const [d, n] of top) console.log(`  ${d.padEnd(22)} ${String(n).padStart(4)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
