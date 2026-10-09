import * as vscode from 'vscode';
import { Checker } from './checker';
import { SafeInstall } from './service';

/** Exposed to the integration tests. */
export interface Api {
  readonly safeInstall: SafeInstall;
  readonly checker: Checker;
}

export function activate(context: vscode.ExtensionContext): Api {
  // Logs list commands and timings; never tokens or environment variables.
  const log = vscode.window.createOutputChannel('safe-install', { log: true });
  const safeInstall = new SafeInstall(log);
  const checker = new Checker(safeInstall, log);
  context.subscriptions.push(log, safeInstall, checker);

  const { version } = context.extension.packageJSON as { version: string };
  log.info(`safe-install extension ${version} activated`);

  context.subscriptions.push(
    vscode.commands.registerCommand('safeInstall.showOutput', () => {
      log.show();
    }),
    vscode.commands.registerCommand('safeInstall.checkProject', () => checker.checkAll()),
  );

  void safeInstall.getStatus().then((status) => {
    safeInstall.explain(status);
    if (status.kind === 'ready') void checker.checkAll();
  });
  return { safeInstall, checker };
}

export function deactivate(): void {
  // Disposables registered on the context clean up everything.
}
