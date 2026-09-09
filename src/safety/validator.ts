import { splitPipelineSegments } from "../utils/shell-parse.js";
import { findDenyMatches, type DenyPattern } from "./denylist.js";

export interface SafetyVerdict {
  allowed: boolean;
  reason?: string;
  patternId?: string;
  segment?: string;
}

/**
 * Decide whether a command is safe to run locally. Any pipeline segment that
 * matches a deny pattern blocks the whole input. This runs BEFORE the
 * classifier commits to executing — a matched rule only executes if
 * validate() returns allowed=true.
 *
 * Unicode lookalikes: we normalize the input to NFKC and additionally check
 * the original string. This catches homoglyph attacks (e.g. Cyrillic "е" in
 * "rеset") for the most common ASCII keywords.
 */
export function validate(input: string): SafetyVerdict {
  // For plain-ASCII input — which is nearly every real command — NFKC
  // normalization and homoglyph stripping are both identity transforms, so
  // the three candidates collapse to one. Deduping avoids running the whole
  // deny list three times over identical text on the hot path.
  const candidates: string[] = [input];
  if (NON_ASCII_RE.test(input)) {
    const nfkc = input.normalize("NFKC");
    if (nfkc !== input) candidates.push(nfkc);
    const stripped = stripHomoglyphs(input);
    if (stripped !== input && stripped !== nfkc) candidates.push(stripped);
  }

  for (const candidate of candidates) {
    // Pipe-to-shell, base64-decoded-shell etc span multiple segments, so we
    // must test the raw candidate before splitting.
    const wholeHits = findDenyMatches(candidate);
    if (wholeHits.length > 0) {
      const first = wholeHits[0]!;
      return {
        allowed: false,
        reason: first.reason,
        patternId: first.id,
        segment: candidate,
      };
    }
    const segments = splitPipelineSegments(candidate);
    for (const seg of segments) {
      const hits: DenyPattern[] = findDenyMatches(seg);
      if (hits.length > 0) {
        const first = hits[0]!;
        return {
          allowed: false,
          reason: first.reason,
          patternId: first.id,
          segment: seg,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Both normalization passes are identity transforms on pure ASCII, so this
 * guard lets the common case skip them entirely.
 */
const NON_ASCII_RE = /[^\x20-\x7E\t\r\n]/;

/**
 * Replace common Cyrillic/Greek homoglyphs that look like ASCII letters with
 * their ASCII counterparts for deny-list matching. We never run the
 * substituted string — only test it against patterns.
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  "а": "a", "А": "A", "е": "e", "Е": "E", "о": "o", "О": "O",
  "р": "p", "Р": "P", "с": "c", "С": "C", "у": "y", "У": "Y",
  "х": "x", "Х": "X", "і": "i", "І": "I", "ј": "j", "Ј": "J",
  "Ѕ": "S", "ѕ": "s", "ԁ": "d", "Ԁ": "D", "ɡ": "g", "Ν": "N",
  "Μ": "M", "Τ": "T", "Ι": "I", "Κ": "K", "Η": "H", "Β": "B",
  "Ε": "E", "Α": "A", "Ρ": "P", "Χ": "X", "Υ": "Y",
};

function stripHomoglyphs(input: string): string {
  let out = "";
  for (const ch of input) {
    out += HOMOGLYPH_MAP[ch] ?? ch;
  }
  return out;
}
