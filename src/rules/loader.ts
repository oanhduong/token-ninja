import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { LoadedRules, Rule, RuleFile } from "./types.js";
import { classify } from "../router/classifier.js";
import { logger } from "../utils/logger.js";

const here = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = resolve(here, "builtin");

function userRulesDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, "token-ninja", "rules");
}

async function readYamlFile(path: string): Promise<RuleFile | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = parseYaml(raw) as RuleFile | undefined;
    if (!parsed || !Array.isArray(parsed.rules)) {
      logger.warn(`skipping ${path}: no rules array`);
      return null;
    }
    for (const r of parsed.rules) {
      if (!r.domain) r.domain = parsed.domain ?? "uncategorized";
    }
    return parsed;
  } catch (err) {
    logger.warn(`failed to parse ${path}: ${(err as Error).message}`);
    return null;
  }
}

async function loadDir(dir: string): Promise<Rule[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: Rule[] = [];
  for (const name of entries) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    const full = join(dir, name);
    const s = await stat(full);
    if (!s.isFile()) continue;
    const file = await readYamlFile(full);
    if (file) out.push(...file.rules);
  }
  return out;
}

let cache: LoadedRules | null = null;

export async function loadRules(): Promise<LoadedRules> {
  if (cache) return cache;
  const builtin = await loadDir(BUILTIN_DIR);
  const user = await loadDir(userRulesDir());
  const all = [...builtin, ...user];

  const seen = new Set<string>();
  const rules: Rule[] = [];
  for (const r of all) {
    if (seen.has(r.id)) {
      logger.warn(`duplicate rule id "${r.id}" — later definition wins`);
      const idx = rules.findIndex((x) => x.id === r.id);
      if (idx >= 0) rules.splice(idx, 1);
    }
    seen.add(r.id);
    rules.push(r);
  }

  const byDomain = new Map<string, Rule[]>();
  const exactIndex = new Map<string, Rule>();
  const prefixRules: Rule[] = [];
  const regexRules: Rule[] = [];
  const nlRules: Rule[] = [];

  for (const r of rules) {
    const arr = byDomain.get(r.domain) ?? [];
    arr.push(r);
    byDomain.set(r.domain, arr);

    switch (r.match.type) {
      case "exact":
        for (const p of r.match.patterns) {
          const norm = p.trim().replace(/\s+/g, " ");
          if (!exactIndex.has(norm)) exactIndex.set(norm, r);
        }
        break;
      case "prefix":
        prefixRules.push(r);
        break;
      case "regex":
        regexRules.push(r);
        break;
      case "nl":
        nlRules.push(r);
        break;
    }
  }

  cache = { rules, byDomain, exactIndex, prefixRules, regexRules, nlRules };
  return cache;
}

export function invalidateRulesCache(): void {
  cache = null;
}

export async function listRules(opts: { domain?: string; json?: boolean }): Promise<void> {
  const loaded = await loadRules();
  const filtered = opts.domain
    ? loaded.rules.filter((r) => r.domain === opts.domain)
    : loaded.rules;

  if (opts.json) {
    process.stdout.write(JSON.stringify(filtered, null, 2) + "\n");
    return;
  }

  const byDomain = new Map<string, Rule[]>();
  for (const r of filtered) {
    const arr = byDomain.get(r.domain) ?? [];
    arr.push(r);
    byDomain.set(r.domain, arr);
  }
  const domains = [...byDomain.keys()].sort();
  let total = 0;
  for (const d of domains) {
    const arr = byDomain.get(d)!;
    total += arr.length;
    process.stdout.write(`\n  ${d}  (${arr.length})\n`);
    for (const r of arr) {
      const summary =
        r.match.type === "exact"
          ? `${r.match.patterns.length} exact`
          : r.match.type === "prefix"
            ? `${r.match.patterns.length} prefix`
            : r.match.type === "regex"
              ? `${r.match.patterns.length} regex`
              : `nl (${r.match.keywords.length} variants)`;
      process.stdout.write(`    ${r.id.padEnd(38)} ${summary.padEnd(14)} ${r.safety}\n`);
    }
  }
  process.stdout.write(`\n  total: ${total} rules across ${domains.length} domains\n`);
}

export async function testRule(input: string): Promise<void> {
  const loaded = await loadRules();
  const result = await classify(input, loaded, { cwd: process.cwd() });
  if (!result) {
    process.stdout.write(`no rule matched: "${input}"\n`);
    process.stdout.write(`would fall back to AI tool\n`);
    process.exit(1);
  }
  process.stdout.write(`matched rule : ${result.rule.id}\n`);
  process.stdout.write(`domain       : ${result.rule.domain}\n`);
  process.stdout.write(`matched via  : ${result.matchedVia}\n`);
  process.stdout.write(`safety tier  : ${result.rule.safety}\n`);
  process.stdout.write(`would run    : ${result.command}\n`);
}
