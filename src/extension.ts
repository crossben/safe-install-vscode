import * as vscode from 'vscode';

/** Output channel for logs; never log tokens or environment variables. */
let log: vscode.LogOutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel('safe-install', { log: true });
  context.subscriptions.push(log);
  const { version } = context.extension.packageJSON as { version: string };
  log.info(`safe-install extension ${version} activated`);
}

export function deactivate(): void {
  log = undefined;
}
