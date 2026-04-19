import { describe, expect, it } from "vitest";
import { routeOnce } from "../src/router/route-once.js";

describe("routeOnce", () => {
  it("returns empty_command for whitespace input", async () => {
    const r = await routeOnce("   ");
    expect(r.handled).toBe(false);
    if (!r.handled) expect(r.reason).toBe("empty_command");
  });

  it("returns safety_block when the raw input trips the deny-list", async () => {
    const r = await routeOnce("rm -rf /");
    expect(r.handled).toBe(false);
    if (!r.handled) expect(r.reason).toBe("safety_block");
  });

  it("returns no_match for gibberish", async () => {
    const r = await routeOnce("xyzzy-unmatchable-input arg arg");
    expect(r.handled).toBe(false);
    if (!r.handled) expect(r.reason).toBe("no_match");
  });

  it("executes a matched read-only rule and captures stdout", async () => {
    // `git status` is one of the most reliable built-ins and safe to run in
    // any git repo (the token-ninja repo itself qualifies).
    const r = await routeOnce("git status");
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(typeof r.rule_id).toBe("string");
      expect(r.rule_id.length).toBeGreaterThan(0);
      expect(typeof r.stdout).toBe("string");
      expect(typeof r.exit_code).toBe("number");
      expect(typeof r.tokens_saved_estimate).toBe("number");
    }
  });

  it("strict mode rejects nl matches", async () => {
    // `what branch am I on` matches via nl keywords in non-strict mode.
    const lax = await routeOnce("what branch am I on");
    expect(lax.handled).toBe(true);
    if (lax.handled) expect(lax.matched_via).toBe("nl");

    const strict = await routeOnce("what branch am I on", { strict: true });
    expect(strict.handled).toBe(false);
    if (!strict.handled) {
      expect(strict.reason).toBe("low_confidence");
      expect(strict.detail).toBe("nl");
    }
  });

  it("strict mode still accepts exact matches", async () => {
    const r = await routeOnce("git status", { strict: true });
    expect(r.handled).toBe(true);
    if (r.handled) expect(r.matched_via).toBe("exact");
  });
});
