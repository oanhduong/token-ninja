import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fallbackToAi } from "../src/router/fallback.js";
import { invalidateConfigCache } from "../src/config/user-config.js";

/**
 * Regression tests for the AI-fallback shell injection.
 *
 * The fallback path receives input that has usually just been REJECTED by the
 * safety validator — `runRouter` blocks `rm -rf ~`, then hands that same
 * string to the AI tool. When the handoff went through `execa(cmd, {shell:
 * true})` with the input interpolated unquoted, every deny pattern in
 * `DENY_PATTERNS` became advisory: the blocked command ran anyway, one
 * process later.
 *
 * Each test below asks the fallback to run a marker-creating payload and
 * asserts the marker does NOT appear.
 */

let home: string;
let binDir: string;
let marker: string;
let argvLog: string;
let origEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  origEnv = { ...process.env };
  home = await mkdtemp(join(tmpdir(), "ninja-inj-"));
  binDir = join(home, "bin");
  await mkdir(binDir, { recursive: true });
  marker = join(home, "PWNED");
  argvLog = join(home, "argv.json");

  // A stand-in for `claude`: records the argv it was handed, prints nothing.
  const fake = join(binDir, "fakeai");
  await writeFile(
    fake,
    `#!/usr/bin/env node\n` +
      `require("node:fs").writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));\n`,
    "utf8"
  );
  await chmod(fake, 0o755);

  process.env.XDG_CONFIG_HOME = join(home, "config");
  process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
  await mkdir(join(process.env.XDG_CONFIG_HOME, "token-ninja"), { recursive: true });
  invalidateConfigCache();
});

afterEach(async () => {
  process.env = origEnv;
  invalidateConfigCache();
  await rm(home, { recursive: true, force: true });
});

async function writeConfig(yaml: string): Promise<void> {
  await writeFile(join(process.env.XDG_CONFIG_HOME!, "token-ninja", "config.yaml"), yaml, "utf8");
  invalidateConfigCache();
}

describe("fallbackToAi — shell injection", () => {
  it("does not execute a `;`-chained command from the input (default template)", async () => {
    await fallbackToAi(`hello; touch ${marker}`, { aiOverride: "fakeai" });
    expect(existsSync(marker)).toBe(false);
  });

  it("passes the whole input as ONE argv entry, not as shell words", async () => {
    await fallbackToAi(`hello; touch ${marker}`, { aiOverride: "fakeai" });
    const argv = JSON.parse(await readFile(argvLog, "utf8")) as string[];
    expect(argv).toEqual([`hello; touch ${marker}`]);
  });

  it("does not execute command substitution from the input", async () => {
    await fallbackToAi(`hello $(touch ${marker})`, { aiOverride: "fakeai" });
    expect(existsSync(marker)).toBe(false);
  });

  it("does not execute a backgrounded command from the input", async () => {
    await fallbackToAi(`hello && touch ${marker}`, { aiOverride: "fakeai" });
    expect(existsSync(marker)).toBe(false);
  });

  it("survives single quotes in the input without breaking out", async () => {
    await fallbackToAi(`it's fine'; touch ${marker}; echo '`, { aiOverride: "fakeai" });
    expect(existsSync(marker)).toBe(false);
  });

  it("quotes the input when a custom fallback_command forces a shell", async () => {
    await writeConfig(`default_ai_tool: fakeai\nfallback_command: "{{tool}} --print {{input}}"\n`);
    await fallbackToAi(`hello; touch ${marker}`, {});
    expect(existsSync(marker)).toBe(false);
    const argv = JSON.parse(await readFile(argvLog, "utf8")) as string[];
    expect(argv).toEqual(["--print", `hello; touch ${marker}`]);
  });

  it("quotes the tool name too, so --ai cannot smuggle a command", async () => {
    await writeConfig(`fallback_command: "{{tool}} {{input}} --quiet"\n`);
    const code = await fallbackToAi("hello", { aiOverride: `fakeai; touch ${marker}` });
    expect(existsSync(marker)).toBe(false);
    // The bogus tool name is not a real binary, so the shell fails it.
    expect(code).not.toBe(0);
  });

  // CodeQL flagged the custom-template path as an indirect uncontrolled
  // command line, and it was right for a reason the alert did not spell out:
  // `String.replace` with a STRING replacement interprets `$&`, `$'`, "$`"
  // and `$1`. Since shellQuote's output was the replacement, an input holding
  // `$'` spliced the rest of the template inside its own quotes and escaped
  // them. Function replacements make the substitution literal.
  it("does not let $' in the input splice the template and break quoting", async () => {
    await writeConfig(`fallback_command: "{{tool}} --print {{input}} --quiet"\n`);
    const payload = `a$'; touch ${marker}; echo '`;
    await fallbackToAi(payload, { aiOverride: "fakeai" });
    expect(existsSync(marker)).toBe(false);
    const argv = JSON.parse(await readFile(argvLog, "utf8")) as string[];
    expect(argv).toEqual(["--print", payload, "--quiet"]);
  });

  it("passes $& and $` through literally", async () => {
    await writeConfig(`fallback_command: "{{tool}} --print {{input}} --quiet"\n`);
    const payload = "why does $& differ from $` here";
    await fallbackToAi(payload, { aiOverride: "fakeai" });
    const argv = JSON.parse(await readFile(argvLog, "utf8")) as string[];
    expect(argv).toEqual(["--print", payload, "--quiet"]);
  });

  it("still forwards a benign command normally", async () => {
    const code = await fallbackToAi("explain this repo", { aiOverride: "fakeai" });
    expect(code).toBe(0);
    const argv = JSON.parse(await readFile(argvLog, "utf8")) as string[];
    expect(argv).toEqual(["explain this repo"]);
  });
});
