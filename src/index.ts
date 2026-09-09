/**
 * Public library entry point.
 *
 * `main` used to point at `cli.js`, so `import "token-ninja"` executed the
 * CLI — it parsed argv and called `process.exit()` inside the importing
 * program. This module exports the pieces worth reusing and runs nothing on
 * import; the CLI stays reachable through the `ninja` / `token-ninja` bins.
 */

export { routeOnce } from "./router/route-once.js";
export type { RouteOnceOpts, RouteOnceResult } from "./router/route-once.js";

export { runRouter } from "./router/index.js";
export type { RouterOpts } from "./router/index.js";

export { classify } from "./router/classifier.js";
export { execShell } from "./router/executor.js";
export type { ExecOpts, ExecResult } from "./router/executor.js";

export { loadRules, invalidateRulesCache } from "./rules/loader.js";
export type {
  ActionSpec,
  ClassifyResult,
  LoadedRules,
  MatchContext,
  MatchSpec,
  Rule,
  RuleFile,
  SafetyTier,
} from "./rules/types.js";

export { validate } from "./safety/validator.js";
export type { SafetyVerdict } from "./safety/validator.js";
export { DENY_PATTERNS, findDenyMatches } from "./safety/denylist.js";
export type { DenyPattern } from "./safety/denylist.js";

export {
  configDir,
  configPath,
  loadConfig,
  invalidateConfigCache,
  userRulesDir,
  DEFAULT_CONFIG,
} from "./config/user-config.js";
export type { Config } from "./config/user-config.js";

export {
  createMcpServer,
  startMcpServer,
  handleMaybeExecuteLocally,
  TOOL_DEFINITION,
  TOOL_NAME,
} from "./mcp/server.js";

export { VERSION } from "./version.js";
