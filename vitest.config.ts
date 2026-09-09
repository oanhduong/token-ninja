import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Benchmarks assert wall-clock budgets, which say as much about the
    // machine as about the code. They run via `npm run bench`
    // (vitest.bench.config.ts) so `npm test` stays deterministic.
    exclude: [...configDefaults.exclude, "tests/benchmark.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      // The whole product, not just the classifier. `setup/`, `doctor/` and
      // `adapters/` are the code that edits the user's rc file and registers
      // MCP servers — the parts where an untested regression is most
      // expensive — so they carry a threshold too.
      include: ["src/**"],
      exclude: [
        "src/rules/builtin/**",
        // Type-only module: no statements to cover.
        "src/rules/types.ts",
        // Commander wiring and pure re-exports; exercised end-to-end by the
        // CLI-spawning tests but with no branches worth asserting.
        "src/cli.ts",
        "src/index.ts",
        "src/version.ts",
      ],
      thresholds: {
        lines: 86,
        branches: 79,
        statements: 86,
        functions: 92,
      },
    },
  },
});
