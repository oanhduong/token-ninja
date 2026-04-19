import { describe, expect, it } from "vitest";
import { execShell } from "../src/router/executor.js";

describe("execShell", () => {
  it("runs a simple command and captures stdout", async () => {
    const r = await execShell("printf hello", { captureOnly: true });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hello");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns a non-zero exit code on failure", async () => {
    const r = await execShell("false", { captureOnly: true });
    expect(r.exitCode).not.toBe(0);
  });

  it("supports pipes (shell:true)", async () => {
    const r = await execShell("printf 'a\\nb\\nc\\n' | wc -l", { captureOnly: true });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("3");
  });

  it("respects cwd", async () => {
    const r = await execShell("pwd", { cwd: "/tmp", captureOnly: true });
    expect(r.stdout.trim()).toBe("/tmp");
  });

  it("passes env vars", async () => {
    const r = await execShell("printf $NINJA_TEST_VAR", {
      env: { NINJA_TEST_VAR: "hello-env" },
      captureOnly: true,
    });
    expect(r.stdout).toBe("hello-env");
  });
});
