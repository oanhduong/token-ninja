import { describe, expect, it } from "vitest";
import { execShell } from "../src/router/executor.js";

/**
 * A local hit is only a win if it is bounded. An MCP caller cannot Ctrl-C a
 * runaway command, and a command that prints 40 MB turns a "saved tokens"
 * hit into the most expensive turn of the session.
 */

describe("execShell — timeout", () => {
  it("kills a command that outlives timeoutMs", async () => {
    const result = await execShell("sleep 5", { captureOnly: true, timeoutMs: 250 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.durationMs).toBeLessThan(4000);
  });

  it("reports the timeout on stderr so the caller can explain it", async () => {
    const result = await execShell("sleep 5", { captureOnly: true, timeoutMs: 250 });
    expect(result.stderr).toContain("timed out");
  });

  it("uses exit code 124 for a timeout, matching GNU timeout", async () => {
    const result = await execShell("sleep 5", { captureOnly: true, timeoutMs: 250 });
    expect(result.exitCode).toBe(124);
  });

  it("leaves a fast command untouched", async () => {
    const result = await execShell("echo hi", { captureOnly: true, timeoutMs: 5000 });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hi");
  });

  it("treats timeoutMs=0 as no timeout", async () => {
    const result = await execShell("echo hi", { captureOnly: true, timeoutMs: 0 });
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).toBe("hi");
  });
});

describe("execShell — output cap", () => {
  const big = `node -e "process.stdout.write('a'.repeat(200000))"`;

  it("stops accumulating past maxOutputBytes", async () => {
    const result = await execShell(big, { captureOnly: true, maxOutputBytes: 4096 });
    expect(result.truncated).toBe(true);
    // The cap is enforced per chunk boundary, so allow one chunk of overshoot
    // rather than asserting an exact byte count.
    expect(result.stdout.length).toBeLessThan(200000);
  });

  it("annotates truncated output so the model is not silently misled", async () => {
    const result = await execShell(big, { captureOnly: true, maxOutputBytes: 4096 });
    expect(result.stdout).toContain("[token-ninja] output truncated");
  });

  it("does not flag small output as truncated", async () => {
    const result = await execShell("echo small", { captureOnly: true, maxOutputBytes: 4096 });
    expect(result.truncated).toBe(false);
    expect(result.stdout).not.toContain("truncated");
  });

  it("treats maxOutputBytes=0 as unlimited", async () => {
    const result = await execShell(`node -e "process.stdout.write('a'.repeat(50000))"`, {
      captureOnly: true,
      maxOutputBytes: 0,
    });
    expect(result.truncated).toBe(false);
    expect(result.stdout.length).toBe(50000);
  });

  it("caps stderr independently of stdout", async () => {
    const result = await execShell(`node -e "process.stderr.write('e'.repeat(200000))"`, {
      captureOnly: true,
      maxOutputBytes: 4096,
    });
    expect(result.truncated).toBe(true);
    expect(result.stderr.length).toBeLessThan(200000);
  });
});
