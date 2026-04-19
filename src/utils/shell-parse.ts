export function normalizeWhitespace(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const a = s[0]!;
    const b = s[s.length - 1]!;
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * Split a shell command on top-level &&, ||, ;, and | that are NOT inside single
 * or double quotes. Returns the individual command segments (trimmed, non-empty).
 * Used by the safety validator so any dangerous segment blocks the whole input.
 */
export function splitPipelineSegments(input: string): string[] {
  const segments: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    const next = input[i + 1];

    if (c === "\\" && (inSingle || inDouble) && next !== undefined) {
      buf += c + next;
      i++;
      continue;
    }
    if (c === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (c === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (c === "`" && !inSingle && !inDouble) inBacktick = !inBacktick;

    const open = inSingle || inDouble || inBacktick;
    if (!open) {
      if ((c === "&" && next === "&") || (c === "|" && next === "|")) {
        if (buf.trim()) segments.push(buf.trim());
        buf = "";
        i++;
        continue;
      }
      if (c === ";" || c === "|" || c === "&") {
        if (buf.trim()) segments.push(buf.trim());
        buf = "";
        continue;
      }
      if (c === "`") {
        if (buf.trim()) segments.push(buf.trim());
        buf = "";
        continue;
      }
    }
    buf += c;
  }
  if (buf.trim()) segments.push(buf.trim());
  return segments;
}

/**
 * Tokenize a single command segment respecting quotes. Does NOT interpret
 * globbing or env expansion — we just need the argv for matching.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === "\\" && i + 1 < input.length) {
      buf += input[i + 1]!;
      i++;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(c)) {
      if (buf) {
        tokens.push(buf);
        buf = "";
      }
      continue;
    }
    buf += c;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

/** Lowercase and strip punctuation for NL keyword matching. */
export function normalizeNl(input: string): string {
  return input
    .toLowerCase()
    .replace(/[?!.,]/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
