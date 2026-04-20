export type SafetyTier = "read-only" | "write-confined" | "write-network" | "blocked";

export type MatchSpec =
  | { type: "exact"; patterns: string[] }
  | { type: "prefix"; patterns: string[] }
  | { type: "regex"; patterns: string[]; flags?: string }
  | { type: "nl"; keywords: string[][]; requires?: string[] };

export type ActionSpec =
  | {
      type: "shell";
      command: string;
      args_passthrough?: boolean;
      requires_tty?: boolean;
    }
  | {
      type: "shell-detect";
      detect: Array<{
        when: string;
        command: string;
      }>;
      fallback?: string;
    }
  | {
      type: "passthrough";
      reason: string;
    };

export interface Rule {
  id: string;
  domain: string;
  description?: string;
  match: MatchSpec;
  action: ActionSpec;
  safety: SafetyTier;
  tokens_saved_estimate?: number;
  examples?: string[];
}

export interface RuleFile {
  domain: string;
  rules: Rule[];
}

export interface PrefixEntry {
  rule: Rule;
  pattern: string;
}

export interface RegexEntry {
  rule: Rule;
  /**
   * Patterns pre-compiled at load time so the classifier hot path iterates
   * over `RegExp` objects directly. Invalid patterns are dropped (a warning
   * is logged once by the loader) so `compiled` never contains `null`.
   */
  compiled: RegExp[];
}

export interface LoadedRules {
  rules: Rule[];
  byDomain: Map<string, Rule[]>;
  exactIndex: Map<string, Rule>;
  prefixRules: Rule[];
  prefixByFirstWord: Map<string, PrefixEntry[]>;
  regexRules: Rule[];
  regexRulesCompiled: RegexEntry[];
  nlRules: Rule[];
}

export interface ClassifyResult {
  rule: Rule;
  command: string;
  capturedArgs?: string;
  matchedVia: "exact" | "prefix" | "regex" | "nl";
}

export interface MatchContext {
  cwd: string;
  repoMarkers?: ReadonlySet<string>;
}
