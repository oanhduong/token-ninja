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
  opts: { cwd?: string; captureOnly?: boolean; env?: NodeJS.ProcessEnv } = {}
): Promise<ExecResult> {
  const start = Date.now();
  try {
    const child = execa(command, {
      shell: true,
      cwd: opts.cwd ?? process.cwd(),
      reject: false,
      all: false,
      stripFinalNewline: false,
      env: { ...process.env, ...(opts.env ?? {}) },
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
