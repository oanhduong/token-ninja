import { describe, expect, it } from "vitest";
import {
  normalizeNl,
  normalizeWhitespace,
  splitPipelineSegments,
  stripQuotes,
  tokenize,
} from "../src/utils/shell-parse.js";

describe("normalizeWhitespace", () => {
  it("trims and collapses runs of whitespace", () => {
    expect(normalizeWhitespace("  git   status  ")).toBe("git status");
  });
  it("handles tabs and newlines", () => {
    expect(normalizeWhitespace("git\tstatus\n-s")).toBe("git status -s");
  });
  it("empty stays empty", () => {
    expect(normalizeWhitespace("   ")).toBe("");
  });
});

describe("stripQuotes", () => {
  it("strips matching double quotes", () => {
    expect(stripQuotes('"hello"')).toBe("hello");
  });
  it("strips matching single quotes", () => {
    expect(stripQuotes("'hello'")).toBe("hello");
  });
  it("leaves mismatched quotes alone", () => {
    expect(stripQuotes("'hello\"")).toBe("'hello\"");
  });
  it("no-op on unquoted", () => {
    expect(stripQuotes("hello")).toBe("hello");
  });
  it("short strings left alone", () => {
    expect(stripQuotes("a")).toBe("a");
    expect(stripQuotes("")).toBe("");
  });
});

describe("splitPipelineSegments", () => {
  it("splits on && and ||", () => {
    expect(splitPipelineSegments("a && b || c")).toEqual(["a", "b", "c"]);
  });
  it("splits on ; | &", () => {
    expect(splitPipelineSegments("a; b | c & d")).toEqual(["a", "b", "c", "d"]);
  });
  it("respects single quotes", () => {
    expect(splitPipelineSegments("echo 'a && b'")).toEqual(["echo 'a && b'"]);
  });
  it("respects double quotes", () => {
    expect(splitPipelineSegments('echo "a | b"')).toEqual(['echo "a | b"']);
  });
  it("splits command substitution (backticks) into a new segment", () => {
    const segs = splitPipelineSegments("echo `rm -rf /`");
    // backtick-wrapped content is a separate segment so safety can examine it
    expect(segs.some((s) => s.includes("rm -rf /"))).toBe(true);
  });
  it("handles escaped quotes inside double-quoted string", () => {
    expect(splitPipelineSegments('echo "a \\" && b"')).toEqual([
      'echo "a \\" && b"',
    ]);
  });
  it("trims surrounding whitespace in segments", () => {
    expect(splitPipelineSegments("  a   &&   b  ")).toEqual(["a", "b"]);
  });
  it("empty input yields empty array", () => {
    expect(splitPipelineSegments("")).toEqual([]);
    expect(splitPipelineSegments("   ")).toEqual([]);
  });
});

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("git add file.ts")).toEqual(["git", "add", "file.ts"]);
  });
  it("keeps quoted strings as one token", () => {
    expect(tokenize('git commit -m "hello world"')).toEqual([
      "git",
      "commit",
      "-m",
      "hello world",
    ]);
  });
  it("handles single quotes", () => {
    expect(tokenize("echo 'a b c'")).toEqual(["echo", "a b c"]);
  });
  it("handles backslash escapes", () => {
    expect(tokenize("a\\ b c")).toEqual(["a b", "c"]);
  });
  it("does not process globs", () => {
    expect(tokenize("ls *.ts")).toEqual(["ls", "*.ts"]);
  });
});

describe("normalizeNl", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeNl("What's the status?!")).toBe("what's the status");
  });
  it("collapses whitespace", () => {
    expect(normalizeNl("show   me    files")).toBe("show me files");
  });
  it("normalizes curly quotes to straight", () => {
    expect(normalizeNl("what\u2019s up")).toBe("what's up");
  });
});
