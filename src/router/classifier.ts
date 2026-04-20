import type { ClassifyResult, LoadedRules, MatchContext, Rule } from "../rules/types.js";
import { normalizeNl, normalizeWhitespace, stripQuotes } from "../utils/shell-parse.js";
import { resolveDetect } from "../utils/repo-detect.js";

/**
 * Match order: exact → prefix → regex → nl. First confident match wins.
 * Safety is NOT checked here; the router calls validate() before executing.
 */
export async function classify(
  inputRaw: string,
  rules: LoadedRules,
  ctx: MatchContext
): Promise<ClassifyResult | null> {
  const input = normalizeWhitespace(inputRaw);
  if (!input) return null;

  // 1. exact
  const exact = rules.exactIndex.get(input);
  if (exact) {
    const cmd = await resolveCommand(exact, "", ctx, input);
    if (cmd) return { rule: exact, command: cmd, matchedVia: "exact" };
  }

  // 2. prefix (longest prefix wins so "git commit -am" beats "git commit").
  // Candidates are bucketed by the first whitespace-delimited token of the
  // pattern so a single input only scans rules that share its first word.
  let bestPrefix: { rule: Rule; pattern: string; args: string } | null = null;
  const firstSpace = input.indexOf(" ");
  const firstWord = firstSpace === -1 ? input : input.slice(0, firstSpace);
  const candidates = rules.prefixByFirstWord.get(firstWord);
  if (candidates) {
    for (const { rule, pattern } of candidates) {
      if (input === pattern || input.startsWith(pattern + " ")) {
        if (!bestPrefix || pattern.length > bestPrefix.pattern.length) {
          bestPrefix = {
            rule,
            pattern,
            args: input.length > pattern.length ? input.slice(pattern.length + 1) : "",
          };
        }
      }
    }
  }
  if (bestPrefix) {
    const cmd = await resolveCommand(bestPrefix.rule, bestPrefix.args, ctx, input);
    if (cmd)
      return {
        rule: bestPrefix.rule,
        command: cmd,
        capturedArgs: bestPrefix.args,
        matchedVia: "prefix",
      };
  }

  // 3. regex — patterns are pre-compiled by the loader, so the hot path here
  // only does match() calls, no RegExp construction.
  for (const { rule, compiled } of rules.regexRulesCompiled) {
    for (const re of compiled) {
      const m = input.match(re);
      if (m) {
        const args = interpolateMatch(m);
        const cmd = await resolveCommand(rule, args, ctx, input);
        if (cmd) return { rule, command: cmd, capturedArgs: args, matchedVia: "regex" };
      }
    }
  }

  // 4. natural language — every keyword group must have all terms present
  const nl = normalizeNl(input);
  if (!nl) return null;
  for (const rule of rules.nlRules) {
    if (rule.match.type !== "nl") continue;
    let matched = false;
    for (const group of rule.match.keywords) {
      if (group.every((term) => containsTerm(nl, term.toLowerCase()))) {
        matched = true;
        break;
      }
    }
    if (!matched) continue;
    const cmd = await resolveCommand(rule, "", ctx, input);
    if (cmd) return { rule, command: cmd, matchedVia: "nl" };
  }

  return null;
}

function containsTerm(haystack: string, term: string): boolean {
  if (term.includes(" ")) return haystack.includes(term);
  const re = new RegExp(`(^|\\s)${escapeRe(term)}(?=$|\\s)`, "i");
  return re.test(haystack);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function interpolateMatch(m: RegExpMatchArray): string {
  const args = m.slice(1).filter((x): x is string => typeof x === "string");
  return args.join(" ");
}

async function resolveCommand(
  rule: Rule,
  args: string,
  ctx: MatchContext,
  input: string
): Promise<string | null> {
  const action = rule.action;
  if (action.type === "passthrough") return null;
  if (action.type === "shell-detect") {
    return resolveDetect(ctx.cwd, action.detect, action.fallback);
  }

  let cmd = action.command;
  // Template support:
  //   {{input}}   → the full original input line
  //   {{args}}    → captured args (regex groups) or empty for exact matches
  //   {{argN}}    → Nth regex capture
  //   {{message}} → first arg, quotes stripped (git commit convention)
  //   {{branch}}/{{target}}/{{path}}/{{script}} → first positional
  //   {{pkg}}     → all positional args joined
  const argParts = splitArgsForTemplate(args);
  cmd = cmd
    .replace(/\{\{\s*input\s*\}\}/g, input)
    .replace(/\{\{\s*args\s*\}\}/g, args.trim() || input)
    .replace(/\{\{\s*message\s*\}\}/g, stripQuotes(args.trim()))
    .replace(/\{\{\s*branch\s*\}\}/g, argParts[0] ?? "")
    .replace(/\{\{\s*target\s*\}\}/g, argParts[0] ?? "")
    .replace(/\{\{\s*path\s*\}\}/g, argParts[0] ?? "")
    .replace(/\{\{\s*script\s*\}\}/g, argParts[0] ?? "")
    .replace(/\{\{\s*pkg\s*\}\}/g, argParts.join(" "))
    .replace(/\{\{\s*arg(\d)\s*\}\}/g, (_m, i: string) => argParts[Number(i) - 1] ?? "")
    .trim();

  if (action.args_passthrough) {
    const base = cmd.trim();
    if (input === base) {
      // nothing to append
    } else if (base && input.startsWith(base + " ")) {
      // Preserve original input so flags between the base and the matched
      // prefix (e.g. `pnpm add -D vitest` matched via pattern `pnpm add -D`)
      // are not dropped.
      cmd = input;
    } else if (args && !cmd.endsWith(args)) {
      // The matched pattern is an alias (e.g. `git st` → `git status`); append
      // the captured trailing args to the normalized base command.
      cmd = `${cmd} ${args}`;
    }
  }
  return cmd || null;
}

function splitArgsForTemplate(args: string): string[] {
  if (!args) return [];
  return args
    .trim()
    .split(/\s+/)
    .map((s) => stripQuotes(s));
}
