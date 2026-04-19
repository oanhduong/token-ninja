import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadRules } from "../rules/loader.js";
import { classify } from "../router/classifier.js";
import { execShell } from "../router/executor.js";
import { validate } from "../safety/validator.js";
import { recordHit, recordFallback, estimateTokensSaved } from "../telemetry/stats.js";

const TOOL_NAME = "maybe_execute_locally";

const TOOL_DEFINITION = {
  name: TOOL_NAME,
  description:
    "Route a command through token-ninja. Returns {handled:true, stdout, stderr, exit_code, rule_id, tokens_saved_estimate} when a local rule matched, or {handled:false, reason} when the AI should handle it. Always call this BEFORE invoking your own LLM — if handled=true, use the output directly.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command or natural-language request to try locally.",
      },
      context: {
        type: "object",
        description: "Optional execution context.",
        properties: {
          cwd: { type: "string", description: "Working directory; defaults to process.cwd()." },
          ai_tool: {
            type: "string",
            description: "Calling AI tool id (claude|codex|cursor|aider|gemini|continue).",
          },
        },
      },
    },
    required: ["command"],
  },
};

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: "token-ninja", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [TOOL_DEFINITION],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== TOOL_NAME) {
      return {
        content: [{ type: "text", text: JSON.stringify({ handled: false, reason: "unknown_tool" }) }],
        isError: true,
      };
    }
    const args = (req.params.arguments ?? {}) as {
      command?: string;
      context?: { cwd?: string; ai_tool?: string };
    };
    const command = typeof args.command === "string" ? args.command : "";
    if (!command.trim()) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ handled: false, reason: "empty_command" }) },
        ],
      };
    }

    const safety = validate(command);
    if (!safety.allowed) {
      await recordFallback("safety_block");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              handled: false,
              reason: "safety_block",
              detail: safety.patternId,
            }),
          },
        ],
      };
    }

    const cwd = args.context?.cwd ?? process.cwd();
    const rules = await loadRules();
    const match = await classify(command, rules, { cwd });
    if (!match) {
      await recordFallback("no_match");
      return {
        content: [{ type: "text", text: JSON.stringify({ handled: false, reason: "no_match" }) }],
      };
    }

    const safety2 = validate(match.command);
    if (!safety2.allowed) {
      await recordFallback("safety_block");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              handled: false,
              reason: "safety_block",
              detail: safety2.patternId,
            }),
          },
        ],
      };
    }

    const result = await execShell(match.command, { cwd, captureOnly: true });
    const tokens = estimateTokensSaved(command, result, match.rule);
    await recordHit(match.rule, command, result);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            handled: true,
            stdout: result.stdout,
            stderr: result.stderr,
            exit_code: result.exitCode,
            rule_id: match.rule.id,
            matched_via: match.matchedVia,
            tokens_saved_estimate: tokens,
          }),
        },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // keep alive until stdin closes
}
