import { describe, expect, it } from "vitest";
import { ADAPTERS, adapterFor, generateShim } from "../src/adapters/index.js";

describe("adapters inventory", () => {
  it("exports at least claude, codex, cursor, aider, gemini, continue, generic", () => {
    const ids = ADAPTERS.map((a) => a.id);
    for (const id of ["claude", "codex", "cursor", "aider", "gemini", "continue", "generic"]) {
      expect(ids).toContain(id);
    }
  });

  it("adapterFor resolves by id and by bin name", () => {
    const byId = adapterFor("claude");
    expect(byId?.id).toBe("claude");
    if (byId?.bin) {
      const byBin = adapterFor(byId.bin);
      expect(byBin?.id).toBe("claude");
    }
  });

  it("adapterFor returns undefined for unknown ids", () => {
    expect(adapterFor("does-not-exist")).toBeUndefined();
  });
});

describe("generateShim", () => {
  it("emits a bash/zsh function for a known tool", async () => {
    const out = await generateShim("claude", "bash");
    expect(out).toContain("claude()");
    expect(out).toContain("ninja --ai claude");
  });

  it("emits a fish function when shell=fish", async () => {
    const out = await generateShim("claude", "fish");
    expect(out).toContain("function claude");
    expect(out).toContain("end");
    expect(out).toContain("ninja --ai claude");
  });

  it("returns an error comment for unknown tools", async () => {
    const out = await generateShim("does-not-exist");
    expect(out).toContain("unknown tool");
  });
});
