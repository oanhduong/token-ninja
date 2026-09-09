import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { routeOnce, type RouteOnceResult } from "../router/route-once.js";
import { VERSION } from "../version.js";

export const TOOL_NAME = "maybe_execute_locally";

export const TOOL_DEFINITION = {
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

export interface CallToolArgs {
  command?: unknown;
  context?: { cwd?: unknown; ai_tool?: unknown };
}

/**
 * The `maybe_execute_locally` handler, extracted from transport wiring so it
 * can be exercised directly in tests. Arguments arrive from an LLM, so every
 * field is treated as untrusted: a non-string command degrades to "" (which
 * routeOnce reports as `empty_command`) rather than throwing.
 */
export async function handleMaybeExecuteLocally(
  args: CallToolArgs | undefined
): Promise<RouteOnceResult> {
  const command = typeof args?.command === "string" ? args.command : "";
  const cwd = typeof args?.context?.cwd === "string" ? args.context.cwd : undefined;
  return routeOnce(command, { cwd });
}

/**
 * Build the MCP server with its handlers registered but no transport attached.
 * `startMcpServer` connects it to stdio; tests connect it to an in-memory pair.
 */
export function createMcpServer(): Server {
  const server = new Server(
    { name: "token-ninja", version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [TOOL_DEFINITION],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== TOOL_NAME) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ handled: false, reason: "unknown_tool" }) },
        ],
        isError: true,
      };
    }
    const result = await handleMaybeExecuteLocally(req.params.arguments as CallToolArgs);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  });

  return server;
}

export async function startMcpServer(transport?: Transport): Promise<Server> {
  const server = createMcpServer();
  await server.connect(transport ?? new StdioServerTransport());
  // keep alive until stdin closes
  return server;
}
