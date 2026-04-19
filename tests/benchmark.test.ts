import { beforeAll, describe, expect, it } from "vitest";
import { loadRules } from "../src/rules/loader.js";
import { classify } from "../src/router/classifier.js";
import { validate } from "../src/safety/validator.js";
import type { LoadedRules } from "../src/rules/types.js";

// The router is in the hot path of every AI-tool invocation. We budget well
// under a millisecond for the typical classify() call; if these numbers
// regress, either the rule set grew pathologically or we introduced a
// quadratic loop.
//
// CI runners are meaningfully slower than dev machines (we see 5-7x on
// GitHub-hosted ubuntu-latest, worse under v8 coverage, worse again on
// macOS runners with noisy neighbors). To keep CI green while still
// catching algorithmic regressions, thresholds are scaled by BENCH_FACTOR
// when CI is detected. Set BENCH_FACTOR=1 locally for strict numbers, or
// SKIP_BENCH=1 to skip the perf assertions entirely (they still log).

const IS_CI = Boolean(process.env.CI);
const SKIP_BENCH = Boolean(process.env.SKIP_BENCH);
const BENCH_FACTOR = Number(process.env.BENCH_FACTOR ?? (IS_CI ? 25 : 1));
const assertUnder = (elapsed: number, budget: number) => {
  if (SKIP_BENCH) return;
  expect(elapsed).toBeLessThan(budget);
};

const SAMPLES = [
  "git status",
  "git diff --staged",
  "git commit -m 'fix: typo'",
  "npm install",
  "npm install -D vitest",
  "pnpm add -D vitest",
  "docker ps",
  "kubectl get pods -n kube-system",
  "cargo build",
  "go test ./...",
  "ls -la",
  "pwd",
  "find . -name foo",
  "rm -rf /tmp/foo",
  "curl -I https://example.com",
  "ping -c 3 google.com",
  "show recent commits",
  "what branch am I on",
];

let rules: LoadedRules;

beforeAll(async () => {
  rules = await loadRules();
});

describe("benchmark: classify", () => {
  it(`classifies 10k commands in <${800 * BENCH_FACTOR}ms`, async () => {
    // warm up the JIT
    for (let i = 0; i < 200; i++) {
      await classify(SAMPLES[i % SAMPLES.length]!, rules, { cwd: "/" });
    }
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      await classify(SAMPLES[i % SAMPLES.length]!, rules, { cwd: "/" });
    }
    const elapsed = performance.now() - start;
    const perCall = elapsed / 10000;
    console.warn(`  classify: ${elapsed.toFixed(0)}ms total, ${perCall.toFixed(3)}ms/call (factor=${BENCH_FACTOR})`);
    assertUnder(elapsed, 800 * BENCH_FACTOR);
  });

  it(`rules cache makes repeat loads instant (<${50 * BENCH_FACTOR}ms for 1k)`, async () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) await loadRules();
    const elapsed = performance.now() - start;
    assertUnder(elapsed, 50 * BENCH_FACTOR);
  });
});

describe("benchmark: safety validator", () => {
  it(`validates 10k commands in <${100 * BENCH_FACTOR}ms`, () => {
    const start = performance.now();
    for (let i = 0; i < 10000; i++) {
      validate(SAMPLES[i % SAMPLES.length]!);
    }
    const elapsed = performance.now() - start;
    console.warn(`  validate: ${elapsed.toFixed(0)}ms total, ${(elapsed / 10).toFixed(1)}µs/call (factor=${BENCH_FACTOR})`);
    assertUnder(elapsed, 100 * BENCH_FACTOR);
  });
});
