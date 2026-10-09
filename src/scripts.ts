import * as path from 'node:path';
import * as vscode from 'vscode';
import { packageArg } from './cli';
import { levelRank, parseExplanations, parseScripts, parseWhy, type ApprovalState, type ScriptPackage } from './model';
import { cliCommand, type SafeInstall } from './service';
import { plain } from './text';

const NEEDS: readonly ApprovalState[] = ['unapproved', 'changed', 'expired'];

type Node =
  | { readonly kind: 'project'; readonly dir: string; readonly pkgs: readonly ScriptPackage[] }
  | { readonly kind: 'group'; readonly dir: string; readonly needs: boolean; readonly pkgs: readonly ScriptPackage[] }
  | { readonly kind: 'pkg'; readonly dir: string; readonly pkg: ScriptPackage }
  | { readonly kind: 'line'; readonly label: string; readonly detail: string; readonly icon: string };

const STATE_LABEL: Record<ApprovalState, string> = {
  unapproved: 'not approved',
  approved: 'approved',
  changed: 'changed since approval',
  expired: 'approval expired',
  provenance: 'approved by provenance',
};

/** Asks the user to confirm an approval. Replaced in tests. */
export type Confirm = (message: string, detail: string, action: string) => Thenable<boolean>;
/** Tells the user why the extension will not approve something. Replaced in tests. */
export type Refuse = (message: string, detail: string) => Thenable<unknown>;

const modalConfirm: Confirm = (message, detail, action) =>
  vscode.window.showWarningMessage(message, { modal: true, detail }, action).then((pick) => pick === action);
const modalRefuse: Refuse = (message, detail) => vscode.window.showErrorMessage(message, { modal: true, detail });

/** The "Install Scripts" view: installed packages that want to run scripts, and their approval state. */
export class ScriptsView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private data = new Map<string, ScriptPackage[]>();
  private dirs: string[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  confirm: Confirm = modalConfirm;
  refuse: Refuse = modalRefuse;

  constructor(
    private readonly cli: SafeInstall,
    private readonly log: vscode.LogOutputChannel,
  ) {
    const policy = vscode.workspace.createFileSystemWatcher('**/.safe-install.json');
    this.disposables.push(
      this.changed,
      policy,
      policy.onDidChange(() => void this.refresh()),
      policy.onDidCreate(() => void this.refresh()),
      policy.onDidDelete(() => void this.refresh()),
      vscode.window.onDidCloseTerminal((t) => {
        if (t.name.startsWith('safe-install approve')) void this.refresh();
      }),
    );
  }

  setProjects(dirs: readonly string[]): void {
    this.dirs = [...dirs].sort();
  }

  /** Re-reads `safe-install scripts` for every project. */
  async refresh(): Promise<void> {
    const next = new Map<string, ScriptPackage[]>();
    for (const dir of this.dirs) {
      try {
        const raw = await this.cli.json(['scripts', '--format', 'json'], dir);
        if (raw !== undefined) next.set(dir, parseScripts(raw));
      } catch (e) {
        this.log.warn(`scripts ${dir}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.data = next;
    const pending = [...next.values()].flat().filter((p) => NEEDS.includes(p.state)).length;
    void vscode.commands.executeCommand('setContext', 'safeInstall.pendingScripts', pending);
    this.changed.fire(undefined);
  }

  packages(): { dir: string; pkg: ScriptPackage }[] {
    return [...this.data].flatMap(([dir, pkgs]) => pkgs.map((pkg) => ({ dir, pkg })));
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      const projects = [...this.data].filter(([, pkgs]) => pkgs.length > 0);
      if (projects.length === 1) {
        const [dir, pkgs] = projects[0] ?? ['', []];
        return groups(dir, pkgs);
      }
      return projects.map(([dir, pkgs]) => ({ kind: 'project', dir, pkgs }));
    }
    switch (node.kind) {
      case 'project':
        return groups(node.dir, node.pkgs);
      case 'group':
        return node.pkgs.map((pkg) => ({ kind: 'pkg', dir: node.dir, pkg }));
      case 'pkg':
        return [
          ...node.pkg.stages.map((s) => ({ kind: 'line' as const, label: `${s}: ${node.pkg.scripts[s] ?? ''}`, detail: '', icon: 'terminal' })),
          ...node.pkg.findings
            .filter((f) => f.rule !== 'SI-SCR-001')
            .map((f) => ({ kind: 'line' as const, label: f.rule, detail: f.message, icon: levelRank(f.severity) >= levelRank('high') ? 'error' : 'warning' })),
        ];
      case 'line':
        return [];
    }
  }

  getTreeItem(node: Node): vscode.TreeItem {
    // Tree labels and descriptions are plain text: package text cannot render as markup.
    switch (node.kind) {
      case 'project': {
        const item = new vscode.TreeItem(vscode.workspace.asRelativePath(node.dir) || path.basename(node.dir), vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('folder');
        return item;
      }
      case 'group': {
        const item = new vscode.TreeItem(
          `${node.needs ? 'Needs your approval' : 'Approved'} (${String(node.pkgs.length)})`,
          node.needs ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.iconPath = new vscode.ThemeIcon(node.needs ? 'warning' : 'pass');
        return item;
      }
      case 'pkg': {
        const { pkg } = node;
        const item = new vscode.TreeItem(pkg.id, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = `${pkg.level === 'none' ? '' : `${pkg.level} · `}${STATE_LABEL[pkg.state]}`;
        item.tooltip = `${pkg.id}\n${STATE_LABEL[pkg.state]}, risk ${pkg.level}\n${pkg.dir}`;
        item.contextValue = NEEDS.includes(pkg.state) ? 'safeInstall.pkg.pending' : 'safeInstall.pkg.approved';
        item.iconPath = new vscode.ThemeIcon(NEEDS.includes(pkg.state) ? (levelRank(pkg.level) >= levelRank('high') ? 'error' : 'warning') : 'pass');
        return item;
      }
      case 'line': {
        const item = new vscode.TreeItem(node.label);
        item.description = node.detail;
        item.tooltip = node.detail === '' ? node.label : `${node.label}: ${node.detail}`;
        item.iconPath = new vscode.ThemeIcon(node.icon);
        return item;
      }
    }
  }

  /**
   * Shows what would run and, on an explicit yes, runs `safe-install approve`
   * in a visible terminal: the CLI started directly, no shell, never --force.
   */
  async approve(target?: { dir: string; pkg: ScriptPackage }): Promise<vscode.Terminal | undefined> {
    const chosen = target ?? (await this.pickPending());
    if (!chosen) return undefined;
    const { dir, pkg } = chosen;
    if ((await this.cli.getStatus()).kind !== 'ready') return undefined;
    const name = packageArg(pkg.name);

    const lines = [
      ...pkg.stages.map((s) => `${s}: ${pkg.scripts[s] ?? ''}`),
      ...pkg.findings.map((f) => `${f.rule} (${f.severity}): ${f.message}`),
    ];
    if (levelRank(pkg.level) >= levelRank('high')) {
      await this.refuse(
        `${pkg.id} is ${pkg.level} risk. The extension does not approve high-risk scripts.`,
        `${lines.join('\n')}\n\nIf you have reviewed it and are sure, run in a terminal:\nsafe-install approve ${name} --force`,
      );
      return undefined;
    }
    const ok = await this.confirm(
      `Run the install scripts of ${pkg.id}?`,
      `${lines.join('\n')}\n\nsafe-install records the approval in .safe-install.json, pinned to these scripts, and runs them now.`,
      'Approve and Run',
    );
    if (!ok) return undefined;
    const cli = cliCommand();
    const terminal = vscode.window.createTerminal({
      name: `safe-install approve ${name}`,
      cwd: dir,
      shellPath: cli.file,
      shellArgs: ['approve', name],
      env: { SAFE_INSTALL_NO_UPDATE_CHECK: '1' },
    });
    terminal.show();
    this.log.info(`approve ${name} (${dir}) in a terminal`);
    return terminal;
  }

  private async pickPending(): Promise<{ dir: string; pkg: ScriptPackage } | undefined> {
    await this.refresh();
    const pending = this.packages().filter((p) => NEEDS.includes(p.pkg.state));
    if (pending.length === 0) {
      void vscode.window.showInformationMessage('No install scripts are waiting for approval.');
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(
      pending.map((p) => ({ label: plain(p.pkg.id), description: plain(`${p.pkg.level} · ${STATE_LABEL[p.pkg.state]}`), detail: plain(p.pkg.stages.map((s) => `${s}: ${p.pkg.scripts[s] ?? ''}`).join('  ·  ')), target: p })),
      { title: 'Approve install scripts', placeHolder: 'Choose a package to review' },
    );
    return pick?.target;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

function groups(dir: string, pkgs: readonly ScriptPackage[]): Node[] {
  const needs = pkgs.filter((p) => NEEDS.includes(p.state));
  const done = pkgs.filter((p) => !NEEDS.includes(p.state));
  return [
    ...(needs.length > 0 ? [{ kind: 'group' as const, dir, needs: true, pkgs: needs }] : []),
    ...(done.length > 0 ? [{ kind: 'group' as const, dir, needs: false, pkgs: done }] : []),
  ];
}

/** "Why is this here?": the dependency chains, read-only, in a quick pick. */
export async function showWhy(cli: SafeInstall, dir: string, spec: string): Promise<void> {
  const raw = await cli.json(['why', packageArg(spec), '--format', 'json'], dir);
  if (raw === undefined) return;
  const results = parseWhy(raw);
  if (results.length === 0) {
    void vscode.window.showInformationMessage(`${plain(spec)} is not in the lockfile.`);
    return;
  }
  await vscode.window.showQuickPick(
    results.flatMap((r) => r.paths.map((p) => ({ label: plain(p.join(' › ')), description: r.direct ? 'direct' : '' }))),
    { title: `Why is ${plain(spec)} here?`, placeHolder: 'Dependency chains from your project (read-only)' },
  );
}

/** "Explain rule": the CLI's explanation, as plain text. */
export async function explainRule(cli: SafeInstall, dir: string, rule?: string): Promise<void> {
  const raw = await cli.json(['explain', '--format', 'json'], dir);
  if (raw === undefined) return;
  const all = parseExplanations(raw);
  const id =
    rule ??
    (await vscode.window.showQuickPick(all.map((e) => ({ label: e.id, description: e.title }))))?.label;
  const e = all.find((x) => x.id === id);
  if (!e) return;
  await vscode.window.showInformationMessage(`${e.id}: ${e.title}`, { modal: true, detail: `Why: ${e.why}\n\nWhat to do: ${e.fix}` });
}
