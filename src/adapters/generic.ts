import type { AiAdapter } from "./index.js";

export const genericAdapter: AiAdapter = {
  id: "generic",
  bin: null,
  description: "Generic passthrough — use with custom fallback_command",
  detect: () => false,
};
