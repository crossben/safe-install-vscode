import * as vscode from 'vscode';
import { SafeInstall } from './service';

/** Exposed to the integration tests. */
export interface Api {
  readonly safeInstall: SafeInstall;
}

export function activate(context: vscode.ExtensionContext): Api {
  // Logs list commands and timings; never tokens or environment variables.
  const log = vscode.window.createOutputChannel('safe-install', { log: true });
  const safeInstall = new SafeInstall(log);
  context.subscriptions.push(log, safeInstall);

  const { version } = context.extension.packageJSON as { version: string };
  log.info(`safe-install extension ${version} activated`);

  context.subscriptions.push(
    vscode.commands.registerCommand('safeInstall.showOutput', () => {
      log.show();
    }),
  );

  void safeInstall.getStatus().then((status) => {
    safeInstall.explain(status);
  });
  return { safeInstall };
}

export function deactivate(): void {
  // Disposables registered on the context clean up everything.
}
