import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { routeOnce } from "../router/route-once.js";

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
    { name: "token-ninja", version: "0.5.0" }, // x-release-please-version
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
    const result = await routeOnce(command, { cwd: args.context?.cwd });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // keep alive until stdin closes
}
