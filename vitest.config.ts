import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/router/**", "src/safety/**", "src/rules/**"],
      exclude: ["src/rules/types.ts", "src/rules/builtin/**"],
      thresholds: {
        lines: 88,
        branches: 82,
        statements: 88,
        functions: 95,
      },
    },
  },
});
