/**
 * Runs the safe-install CLI. Plain Node (no `vscode` import) so it can be unit
 * tested; this is the only module allowed to start processes.
 *
 * Security: no shell is ever involved (execFile with an argument array), every
 * call has a timeout and an output cap, and package names, which come from
 * untrusted package.json files, can never be read as flags.
 */
import { execFile } from 'node:child_process';

/** How to start the CLI: an executable plus fixed leading arguments (tests use `node fake-cli.js`). */
export interface CliCommand {
  readonly file: string;
  readonly prefix?: readonly string[];
}

export interface RunOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Largest stdout or stderr accepted, in bytes. */
  readonly maxBytes?: number;
}

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The CLI ran but reported a problem (exit code 3), or could not be run at all. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly kind: 'not-found' | 'timeout' | 'cancelled' | 'too-large' | 'tool-error' | 'bad-output',
    readonly stderr = '',
  ) {
    super(message);
    this.name = 'CliError';
  }
}

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/** Exit codes: 0 ok, 1 policy failure (a result, not an error), 3 tool error. */
export function run(cli: CliCommand, args: readonly string[], opts: RunOptions): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, SAFE_INSTALL_NO_UPDATE_CHECK: '1', NO_COLOR: '1' };
  // Set inside VS Code's own process tree; harmless for Go but keep the child clean.
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    execFile(
      cli.file,
      [...(cli.prefix ?? []), ...args],
      {
        cwd: opts.cwd,
        env,
        timeout: opts.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: opts.maxBytes ?? DEFAULT_MAX_BYTES,
        windowsHide: true,
        shell: false,
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const e = err as NodeJS.ErrnoException & { code?: string | number; killed?: boolean };
        if (e.name === 'AbortError') {
          reject(new CliError('cancelled', 'cancelled'));
        } else if (e.code === 'ENOENT' || e.code === 'EACCES') {
          reject(new CliError(`cannot run ${cli.file}: ${e.code}`, 'not-found'));
        } else if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          reject(new CliError('safe-install output too large', 'too-large'));
        } else if (e.killed) {
          reject(new CliError(`safe-install timed out after ${String(opts.timeoutMs / 1000)}s`, 'timeout'));
        } else if (typeof e.code === 'number') {
          resolve({ code: e.code, stdout, stderr });
        } else {
          reject(new CliError(e.message, 'tool-error', stderr));
        }
      },
    );
  });
}

/** Runs a command that prints JSON and parses it; exit 3 becomes a CliError. */
export async function runJSON(cli: CliCommand, args: readonly string[], opts: RunOptions): Promise<unknown> {
  const res = await run(cli, args, opts);
  if (res.code !== 0 && res.code !== 1) {
    throw new CliError(lastLine(res.stderr) || `safe-install exited with ${String(res.code)}`, 'tool-error', res.stderr);
  }
  try {
    return JSON.parse(res.stdout) as unknown;
  } catch {
    throw new CliError('safe-install printed something that is not JSON', 'bad-output', res.stderr);
  }
}

/**
 * A package argument (`name` or `name@version`) taken from a project file.
 * Rejects anything that could be read as a flag or is not a plausible name.
 */
export function packageArg(spec: string): string {
  if (spec === '' || spec.startsWith('-') || spec.length > 300 || /[\s\0]/.test(spec)) {
    throw new CliError(`not a package name: ${JSON.stringify(spec.slice(0, 80))}`, 'bad-output');
  }
  return spec;
}

function lastLine(s: string): string {
  const lines = s.trim().split(/\r?\n/);
  return (lines[lines.length - 1] ?? '').replace(/^safe-install:\s*/, '');
}
