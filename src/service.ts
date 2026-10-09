import * as vscode from 'vscode';
import { CliError, runJSON, run, type CliCommand } from './cli';
import { DOCS_URL, installHint } from './install';
import { MIN_CLI_VERSION, atLeast, isDevBuild, parseVersionLine } from './version';

export type CliStatus =
  | { readonly kind: 'ready'; readonly version: string }
  | { readonly kind: 'untrusted' }
  | { readonly kind: 'missing'; readonly detail: string }
  | { readonly kind: 'outdated'; readonly version: string };


/**
 * The CLI path comes from user settings only. `safeInstall.path` is declared
 * machine-scoped, so VS Code already ignores it in workspace settings; reading
 * only the global value is a second guard: a repository must never be able to
 * point the extension at a binary of its choosing.
 */
export function cliCommand(): CliCommand {
  const configured = vscode.workspace.getConfiguration('safeInstall').inspect<string>('path')?.globalValue;
  return { file: typeof configured === 'string' && configured.trim() !== '' ? configured.trim() : 'safe-install' };
}

function timeoutMs(): number {
  const s = vscode.workspace.getConfiguration('safeInstall').get<number>('timeoutSeconds', 60);
  return Math.min(Math.max(s, 5), 600) * 1000;
}

/** Runs the CLI for the extension: gated on Workspace Trust and the CLI version, logged. */
export class SafeInstall implements vscode.Disposable {
  private status: Promise<CliStatus> | undefined;
  private warned = new Set<CliStatus['kind']>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.disposables.push(
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.status = undefined;
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('safeInstall.path')) this.status = undefined;
      }),
    );
  }

  /** Checks once (until trust or the path setting changes) that the CLI can be used. */
  getStatus(): Promise<CliStatus> {
    this.status ??= this.probe();
    return this.status;
  }

  private async probe(): Promise<CliStatus> {
    if (!vscode.workspace.isTrusted) return { kind: 'untrusted' };
    const cli = cliCommand();
    try {
      const res = await run(cli, ['--version'], { cwd: process.cwd(), timeoutMs: 10_000 });
      const line = res.stdout.trim();
      this.log.info(`using ${cli.file}: ${line}`);
      if (isDevBuild(line)) return { kind: 'ready', version: 'dev' };
      const v = parseVersionLine(line);
      if (!v) return { kind: 'missing', detail: `${cli.file} does not look like safe-install` };
      const version = v.join('.');
      return atLeast(v, MIN_CLI_VERSION) ? { kind: 'ready', version } : { kind: 'outdated', version };
    } catch (e) {
      return { kind: 'missing', detail: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Runs a JSON command in `cwd`. Returns undefined when the CLI cannot be
   * used (after telling the user once why).
   */
  async json(args: readonly string[], cwd: string, token?: vscode.CancellationToken): Promise<unknown> {
    const status = await this.getStatus();
    if (status.kind !== 'ready') {
      this.explain(status);
      return undefined;
    }
    const ac = new AbortController();
    const sub = token?.onCancellationRequested(() => {
      ac.abort();
    });
    const started = Date.now();
    try {
      const out = await runJSON(cliCommand(), args, { cwd, timeoutMs: timeoutMs(), signal: ac.signal });
      this.log.info(`safe-install ${args.join(' ')} (${cwd}) in ${String(Date.now() - started)} ms`);
      return out;
    } catch (e) {
      if (e instanceof CliError && e.kind === 'cancelled') return undefined;
      this.log.error(`safe-install ${args.join(' ')} (${cwd}): ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    } finally {
      sub?.dispose();
    }
  }

  /** Tells the user, once per kind, why nothing is shown. */
  explain(status: CliStatus): void {
    if (status.kind === 'ready' || this.warned.has(status.kind)) return;
    this.warned.add(status.kind);
    switch (status.kind) {
      case 'untrusted':
        void vscode.window.showInformationMessage(
          'safe-install does not run in Restricted Mode: it reads project files such as .npmrc and .safe-install.json, which come from this repository. Trust the folder to see dependency risks.',
        );
        break;
      case 'missing':
        this.log.warn(status.detail);
        void this.offerInstall('safe-install CLI not found. The extension needs it to check your dependencies.', false);
        break;
      case 'outdated':
        void this.offerInstall(`safe-install ${status.version} is too old for this extension (needs ${MIN_CLI_VERSION} or later).`, true);
        break;
    }
  }

  private async offerInstall(message: string, update: boolean): Promise<void> {
    const hint = installHint(process.platform, update);
    const copy = hint.command ? `Copy ${update ? 'Update' : 'Install'} Command` : undefined;
    const actions = [copy, 'Open Install Docs', ...(update ? [] : ['Set Path…'])].filter((a): a is string => a !== undefined);
    const pick = await vscode.window.showWarningMessage(`${message} ${update ? 'Update' : 'Install'} it with ${hint.how}.`, ...actions);
    if (pick === copy && hint.command) {
      await vscode.env.clipboard.writeText(hint.command);
      void vscode.window.showInformationMessage(`Copied: ${hint.command}`);
    } else if (pick === 'Open Install Docs') {
      await vscode.env.openExternal(vscode.Uri.parse(DOCS_URL));
    } else if (pick === 'Set Path…') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'safeInstall.path');
    }
  }

  /** Runs a command that prints text (not JSON), e.g. `llm`. */
  async text(args: readonly string[], cwd: string): Promise<string | undefined> {
    const status = await this.getStatus();
    if (status.kind !== 'ready') {
      this.explain(status);
      return undefined;
    }
    const res = await run(cliCommand(), args, { cwd, timeoutMs: timeoutMs() });
    if (res.code !== 0) throw new CliError(res.stderr.trim() || `safe-install exited with ${String(res.code)}`, 'tool-error', res.stderr);
    return res.stdout;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
