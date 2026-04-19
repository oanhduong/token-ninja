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

export interface LoadedRules {
  rules: Rule[];
  byDomain: Map<string, Rule[]>;
  exactIndex: Map<string, Rule>;
  prefixRules: Rule[];
  regexRules: Rule[];
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
