import * as vscode from 'vscode';
import * as path from 'node:path';
import { Checker } from './checker';
import { ScriptsView, explainRule, showWhy } from './scripts';
import { SafeInstall } from './service';

/** Exposed to the integration tests. */
export interface Api {
  readonly safeInstall: SafeInstall;
  readonly checker: Checker;
  readonly scripts: ScriptsView;
}

export function activate(context: vscode.ExtensionContext): Api {
  // Logs list commands and timings; never tokens or environment variables.
  const log = vscode.window.createOutputChannel('safe-install', { log: true });
  const safeInstall = new SafeInstall(log);
  const checker = new Checker(safeInstall, log);
  const scripts = new ScriptsView(safeInstall, log);
  context.subscriptions.push(log, safeInstall, checker, scripts);
  context.subscriptions.push(
    vscode.window.createTreeView('safeInstall.scripts', { treeDataProvider: scripts, showCollapseAll: true }),
    checker.onDidCheck(() => {
      scripts.setProjects(checker.projectDirs());
      void scripts.refresh();
    }),
    vscode.languages.registerCodeActionsProvider({ language: 'json', pattern: '**/package.json' }, new QuickFixes(), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
  );

  const { version } = context.extension.packageJSON as { version: string };
  log.info(`safe-install extension ${version} activated`);

  context.subscriptions.push(
    vscode.commands.registerCommand('safeInstall.showOutput', () => {
      log.show();
    }),
    vscode.commands.registerCommand('safeInstall.checkProject', () => checker.checkAll()),
    vscode.commands.registerCommand('safeInstall.refreshScripts', () => scripts.refresh()),
    vscode.commands.registerCommand('safeInstall.approve', (node?: Parameters<ScriptsView['approve']>[0]) => scripts.approve(node)),
    vscode.commands.registerCommand('safeInstall.why', async (dir?: string, spec?: string) => {
      const folder = dir ?? checker.projectDirs()[0];
      const name = spec ?? (await vscode.window.showInputBox({ title: 'Why is this package here?', prompt: 'Package name, optionally @version' }));
      if (folder && name) await showWhy(safeInstall, folder, name);
    }),
    vscode.commands.registerCommand('safeInstall.explainRule', (rule?: string) => {
      const folder = checker.projectDirs()[0] ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      return folder ? explainRule(safeInstall, folder, rule) : undefined;
    }),
  );

  void safeInstall.getStatus().then((status) => {
    safeInstall.explain(status);
    if (status.kind === 'ready') void checker.checkAll();
  });
  return { safeInstall, checker, scripts };
}

/** Quick fixes on safe-install markers: why the package is here, and what the rule means. */
class QuickFixes implements vscode.CodeActionProvider {
  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const out: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics.filter((x) => x.source === 'safe-install')) {
      const name = doc.getText(d.range);
      const why = new vscode.CodeAction(`Why is ${name} here? (safe-install)`, vscode.CodeActionKind.QuickFix);
      why.command = { title: why.title, command: 'safeInstall.why', arguments: [path.dirname(doc.uri.fsPath), name] };
      why.diagnostics = [d];
      out.push(why);
      if (typeof d.code === 'string') {
        const explain = new vscode.CodeAction(`Explain ${d.code} (safe-install)`, vscode.CodeActionKind.QuickFix);
        explain.command = { title: explain.title, command: 'safeInstall.explainRule', arguments: [d.code] };
        explain.diagnostics = [d];
        out.push(explain);
      }
    }
    return out;
  }
}

export function deactivate(): void {
  // Disposables registered on the context clean up everything.
}
