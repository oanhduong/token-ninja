import { defineConfig } from "vitest/config";

/**
 * Benchmarks live in their own project so `npm test` stays a correctness
 * gate. Wall-clock budgets are a property of the machine as much as of the
 * code: the same suite that passes on CI (BENCH_FACTOR=25) fails on a
 * throttled laptop or inside a container, and a contributor whose first
 * `npm test` is red learns to ignore red.
 *
 * Run them deliberately: `npm run bench`.
 */
export default defineConfig({
  test: {
    include: ["tests/benchmark.test.ts"],
  },
});
