import { execa } from "execa";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Execute a shell command. We use `execa(..., { shell: true })` so the YAML
 * rules can use pipes, redirects, and quoted args naturally — the safety
 * validator has already vetted the full input, and the rule itself is
 * author-trusted. We stream stdout/stderr to the parent terminal and also
 * capture them for stats / MCP responses.
 *
 * When `captureOnly` is true, we do NOT stream to the terminal; used by the
 * MCP server so the AI tool gets structured output.
 */
export async function execShell(
  command: string,
  opts: {
    cwd?: string;
    captureOnly?: boolean;
    env?: NodeJS.ProcessEnv;
    /**
     * Force CLI tools to emit ANSI color escapes even though stdout is a
     * pipe (execa uses `stdio: "pipe"` to capture). Used by the Claude Code
     * UserPromptSubmit hook so `git status`, `ls`, etc. render colorized
     * inside the block-reason. Not set for MCP — the model gets plain text
     * to avoid wasting tokens on escape sequences.
     */
    forceColor?: boolean;
  } = {}
): Promise<ExecResult> {
  const start = Date.now();
  const colorEnv: NodeJS.ProcessEnv = opts.forceColor
    ? {
        // Node-based CLIs (chalk/kleur/picocolors) and most JS test runners.
        FORCE_COLOR: "1",
        // BSD userland (macOS `ls`, some others).
        CLICOLOR: "1",
        CLICOLOR_FORCE: "1",
        // Git: override the piped-stdout auto-disable.
        GIT_CONFIG_PARAMETERS: "'color.ui=always'",
        // Cargo, rustc wrappers.
        CARGO_TERM_COLOR: "always",
        // Python — colorama / rich / pytest-color.
        PY_COLORS: "1",
        // Explicitly clear NO_COLOR in case the parent set it.
        NO_COLOR: "",
      }
    : {};
  try {
    const child = execa(command, {
      shell: true,
      cwd: opts.cwd ?? process.cwd(),
      reject: false,
      all: false,
      stripFinalNewline: false,
      env: { ...process.env, ...colorEnv, ...(opts.env ?? {}) },
      stdio: opts.captureOnly ? ["ignore", "pipe", "pipe"] : ["inherit", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        const s = chunk.toString();
        stdout += s;
        if (!opts.captureOnly) process.stdout.write(s);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        const s = chunk.toString();
        stderr += s;
        if (!opts.captureOnly) process.stderr.write(s);
      });
    }

    const result = await child;
    return {
      stdout,
      stderr,
      exitCode: typeof result.exitCode === "number" ? result.exitCode : 0,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      stdout: "",
      stderr: message + "\n",
      exitCode: 1,
      durationMs: Date.now() - start,
    };
  }
}
