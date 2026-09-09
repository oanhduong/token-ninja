import { execa } from "execa";
import { DEFAULT_EXEC_TIMEOUT_MS, DEFAULT_MAX_OUTPUT_BYTES } from "../config/user-config.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  /** True when stdout or stderr hit `maxOutputBytes` and was cut short. */
  truncated: boolean;
  /** True when the command was killed for exceeding `timeoutMs`. */
  timedOut: boolean;
}

export interface ExecOpts {
  cwd?: string;
  /**
   * Capture output without streaming it to the terminal; used by the MCP
   * server and the Claude Code hook so the caller gets structured output.
   */
  captureOnly?: boolean;
  /**
   * Hand the child the parent's stdin/stdout/stderr untouched. Nothing is
   * captured, but interactive programs get a real TTY. Used for rules marked
   * `requires_tty` (docker exec -it, kubectl exec -it).
   */
  inheritAll?: boolean;
  env?: NodeJS.ProcessEnv;
  /**
   * Force CLI tools to emit ANSI color escapes even though stdout is a
   * pipe (execa uses `stdio: "pipe"` to capture). Used by the Claude Code
   * UserPromptSubmit hook so `git status`, `ls`, etc. render colorized
   * inside the block-reason. Not set for MCP — the model gets plain text
   * to avoid wasting tokens on escape sequences.
   */
  forceColor?: boolean;
  /** Kill the command after this many ms. 0 or Infinity disables. */
  timeoutMs?: number;
  /** Stop accumulating each stream past this many bytes. 0 disables. */
  maxOutputBytes?: number;
}

/**
 * Signal an entire process group. `-pid` addresses the group led by `pid`,
 * which is what `detached: true` created. Failures are ignored: the usual
 * cause is that the group already exited on its own.
 */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    /* already gone */
  }
}

/**
 * Execute a shell command. We use `execa(..., { shell: true })` so the YAML
 * rules can use pipes, redirects, and quoted args naturally — the safety
 * validator has already vetted the full input, and the rule itself is
 * author-trusted. We stream stdout/stderr to the parent terminal and also
 * capture them for stats / MCP responses.
 *
 * Two bounds keep a local hit from becoming worse than the AI round-trip it
 * replaced: `timeoutMs` stops a command that never exits (an MCP caller has
 * no way to Ctrl-C), and `maxOutputBytes` stops a chatty one from pinning
 * megabytes in memory and then spending them as context tokens.
 */
export async function execShell(command: string, opts: ExecOpts = {}): Promise<ExecResult> {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
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
  const wantTimeout = timeoutMs > 0 && Number.isFinite(timeoutMs);
  // `shell: true` means the child is `sh -c "…"`. Signalling just that shell
  // leaves its own children running, and they keep the stdout pipe open — so
  // execa's built-in timeout marks the run as timed out but the promise still
  // blocks for the full duration of the runaway command. Killing the whole
  // process group is what actually frees the caller.
  //
  // Process groups need `detached`, which puts the child in a BACKGROUND
  // group: anything that then reads the terminal takes SIGTTIN and stops. So
  // we only detach when stdin is already "ignore" (captureOnly — the MCP and
  // hook paths, which are also the ones with no human able to press Ctrl-C).
  // The interactive path keeps execa's timeout as a best-effort bound.
  const useGroupKill = wantTimeout && opts.captureOnly === true && process.platform !== "win32";

  try {
    const child = execa(command, {
      shell: true,
      cwd: opts.cwd ?? process.cwd(),
      reject: false,
      all: false,
      stripFinalNewline: false,
      detached: useGroupKill,
      ...(wantTimeout && !useGroupKill ? { timeout: timeoutMs } : {}),
      env: { ...process.env, ...colorEnv, ...(opts.env ?? {}) },
      stdio: opts.inheritAll
        ? "inherit"
        : opts.captureOnly
          ? ["ignore", "pipe", "pipe"]
          : ["inherit", "pipe", "pipe"],
    });

    let killedByTimeout = false;
    let killTimer: NodeJS.Timeout | undefined;
    if (useGroupKill && child.pid !== undefined) {
      const pid = child.pid;
      killTimer = setTimeout(() => {
        killedByTimeout = true;
        killGroup(pid, "SIGTERM");
        // A process that ignores SIGTERM still has to go, or we are back to
        // an unbounded wait.
        setTimeout(() => killGroup(pid, "SIGKILL"), 2000).unref();
      }, timeoutMs);
    }

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const capped = maxOutputBytes > 0 && Number.isFinite(maxOutputBytes);

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        const s = chunk.toString();
        if (!capped || stdoutBytes < maxOutputBytes) {
          stdout += s;
          stdoutBytes += chunk.length;
          if (capped && stdoutBytes >= maxOutputBytes) truncated = true;
        }
        if (!opts.captureOnly) process.stdout.write(s);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        const s = chunk.toString();
        if (!capped || stderrBytes < maxOutputBytes) {
          stderr += s;
          stderrBytes += chunk.length;
          if (capped && stderrBytes >= maxOutputBytes) truncated = true;
        }
        if (!opts.captureOnly) process.stderr.write(s);
      });
    }

    const result = await child;
    if (killTimer) clearTimeout(killTimer);
    const timedOut = result.timedOut === true || killedByTimeout;
    if (truncated) {
      stdout += `\n[token-ninja] output truncated at ${maxOutputBytes} bytes\n`;
    }
    if (timedOut) {
      stderr += `\n[token-ninja] command timed out after ${timeoutMs}ms\n`;
    }
    return {
      stdout,
      stderr,
      // A timed-out child reports exitCode undefined; surface the conventional
      // 124 (GNU timeout) instead of pretending it succeeded.
      exitCode: typeof result.exitCode === "number" ? result.exitCode : timedOut ? 124 : 0,
      durationMs: Date.now() - start,
      truncated,
      timedOut,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      stdout: "",
      stderr: message + "\n",
      exitCode: 1,
      durationMs: Date.now() - start,
      truncated: false,
      timedOut: false,
    };
  }
}
