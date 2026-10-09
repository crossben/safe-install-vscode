import * as path from 'node:path';
import * as vscode from 'vscode';
import { packageArg } from './cli';
import { byDependency, MAX_TRANSITIVE, risky, type DependencyResult } from './findings';
import { declaredDependencies } from './manifest';
import { levelRank, parseCheck, parseExplanations, parseWhy, type Explanation, type Level } from './model';
import type { SafeInstall } from './service';
import { codeSpan } from './text';

export const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];

interface ProjectState {
  readonly dir: string;
  readonly manifest: vscode.Uri;
  results: Map<string, DependencyResult>;
  worst: Level;
  running?: vscode.CancellationTokenSource | undefined;
  timer?: ReturnType<typeof setTimeout> | undefined;
}

const SEVERITY: Record<Level, vscode.DiagnosticSeverity> = {
  none: vscode.DiagnosticSeverity.Hint,
  low: vscode.DiagnosticSeverity.Information,
  medium: vscode.DiagnosticSeverity.Warning,
  high: vscode.DiagnosticSeverity.Error,
  block: vscode.DiagnosticSeverity.Error,
};

function config() {
  const c = vscode.workspace.getConfiguration('safeInstall');
  const min = c.get<string>('minSeverity', 'low');
  return {
    checkOnSave: c.get<boolean>('checkOnSave', true),
    diffBase: c.get<string>('diffBase', '').trim(),
    minSeverity: (['low', 'medium', 'high', 'block'].includes(min) ? min : 'low') as Level,
  };
}

/** Checks each project (a folder with package.json and a lockfile) and shows the results. */
export class Checker implements vscode.Disposable, vscode.HoverProvider, vscode.CodeLensProvider {
  private readonly projects = new Map<string, ProjectState>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('safe-install');
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private readonly lensChanged = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensChanged.event;
  private explanations: Promise<Map<string, Explanation>> | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly checked = new vscode.EventEmitter<void>();
  /** Fires after a round of checks, so other views can refresh. */
  readonly onDidCheck = this.checked.event;
  /** Resolves when every pending check has finished (tests). */
  idle: Promise<void> = Promise.resolve();

  constructor(
    private readonly cli: SafeInstall,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.status.name = 'safe-install';
    this.status.command = 'workbench.actions.view.problems';
    const manifests = { language: 'json', pattern: '**/package.json' };
    this.disposables.push(
      this.diagnostics,
      this.status,
      this.lensChanged,
      this.checked,
      vscode.languages.registerHoverProvider(manifests, this),
      vscode.languages.registerCodeLensProvider(manifests, this),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (config().checkOnSave) this.onSaved(doc.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('safeInstall')) void this.checkAll();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        void this.checkAll();
      }),
    );
  }

  /** Finds every project in the workspace and checks them all. */
  async checkAll(): Promise<void> {
    const locks = await vscode.workspace.findFiles(`**/{${LOCKFILES.join(',')}}`, '**/node_modules/**', 200);
    for (const lock of locks) {
      const dir = path.dirname(lock.fsPath);
      if (!this.projects.has(dir)) {
        this.projects.set(dir, { dir, manifest: vscode.Uri.file(path.join(dir, 'package.json')), results: new Map(), worst: 'none' });
      }
    }
    await Promise.all([...this.projects.values()].map((p) => this.check(p)));
    this.checked.fire();
  }

  projectDirs(): string[] {
    return [...this.projects.keys()];
  }

  private onSaved(uri: vscode.Uri): void {
    const base = path.basename(uri.fsPath);
    if (base !== 'package.json' && !LOCKFILES.includes(base)) return;
    const project = this.projects.get(path.dirname(uri.fsPath));
    if (!project) {
      void this.checkAll(); // a new project, or a lockfile that just appeared
      return;
    }
    // Saving package.json and the lockfile together runs one check.
    if (project.timer) clearTimeout(project.timer);
    project.timer = setTimeout(() => {
      void this.check(project).then(() => {
        this.checked.fire();
      });
    }, 600);
  }

  private check(p: ProjectState): Promise<void> {
    p.running?.cancel();
    const cts = new vscode.CancellationTokenSource();
    p.running = cts;
    const run = this.runCheck(p, cts.token)
      .catch((e: unknown) => {
        this.log.error(`check ${p.dir}: ${e instanceof Error ? e.message : String(e)}`);
        this.diagnostics.set(p.manifest, [
          new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), `safe-install could not check this project: ${e instanceof Error ? e.message : String(e)}`, vscode.DiagnosticSeverity.Warning),
        ]);
      })
      .finally(() => {
        if (p.running === cts) p.running = undefined;
        cts.dispose();
        this.render();
      });
    this.idle = Promise.all([this.idle, run]).then(() => undefined);
    return run;
  }

  private async runCheck(p: ProjectState, token: vscode.CancellationToken): Promise<void> {
    const { diffBase, minSeverity } = config();
    const args = ['check', '--format', 'json', '--fail-on', 'none'];
    if (diffBase !== '') args.push('--diff', diffBase);
    const raw = await this.cli.json(args, p.dir, token);
    if (raw === undefined || cancelled(token)) return;
    const report = parseCheck(raw);

    // A chain for each risky transitive package (capped: one `why` each).
    const chains = new Map<string, readonly string[]>();
    const transitive = risky(report, minSeverity).filter((pkg) => !pkg.direct).slice(0, MAX_TRANSITIVE);
    for (const pkg of transitive) {
      if (cancelled(token)) return;
      const why = parseWhy(await this.cli.json(['why', packageArg(pkg.id), '--format', 'json'], p.dir, token));
      const first = why.find((w) => w.id === pkg.id)?.paths[0];
      if (first && first.length > 0) chains.set(pkg.id, first);
    }
    if (cancelled(token)) return;

    p.results = byDependency(report, minSeverity, chains);
    p.worst = [...p.results.values()].reduce<Level>((w, r) => (levelRank(r.level) > levelRank(w) ? r.level : w), 'none');
    await this.publish(p, report.warnings);
  }

  private async publish(p: ProjectState, warnings: readonly string[]): Promise<void> {
    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(p.manifest));
    } catch {
      return; // a lockfile without package.json: nothing to mark
    }
    const doc = { positionAt: offsetToPosition(text) };
    const diags: vscode.Diagnostic[] = [];
    for (const dep of declaredDependencies(text)) {
      const r = p.results.get(dep.name);
      if (!r) continue;
      const d = new vscode.Diagnostic(new vscode.Range(doc.positionAt(dep.start), doc.positionAt(dep.end)), summary(r), SEVERITY[r.level]);
      d.source = 'safe-install';
      const rule = r.own?.findings[0]?.rule ?? r.via[0]?.pkg.findings[0]?.rule;
      if (rule) d.code = rule;
      diags.push(d);
    }
    for (const w of warnings) {
      diags.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), `safe-install: ${w}`, vscode.DiagnosticSeverity.Information));
    }
    this.diagnostics.set(p.manifest, diags);
  }

  private render(): void {
    let worst: Level = 'none';
    let count = 0;
    for (const p of this.projects.values()) {
      if (levelRank(p.worst) > levelRank(worst)) worst = p.worst;
      for (const r of p.results.values()) if (levelRank(r.level) >= levelRank('high')) count++;
    }
    const running = [...this.projects.values()].some((p) => p.running);
    this.status.text = running
      ? '$(sync~spin) safe-install'
      : worst === 'none'
        ? '$(shield) safe-install'
        : `$(${levelRank(worst) >= levelRank('high') ? 'error' : 'warning'}) safe-install: ${count > 0 ? `${String(count)} high` : worst}`;
    this.status.tooltip = worst === 'none' ? 'No risky dependencies found' : `Worst level: ${worst}. Click to see the Problems panel.`;
    if (this.projects.size > 0) this.status.show();
    this.lensChanged.fire();
  }

  private resultAt(doc: vscode.TextDocument, pos: vscode.Position): { r: DependencyResult; range: vscode.Range } | undefined {
    const p = this.projects.get(path.dirname(doc.uri.fsPath));
    if (!p) return undefined;
    const offset = doc.offsetAt(pos);
    const dep = declaredDependencies(doc.getText()).find((d) => offset >= d.start - 1 && offset <= d.end + 1);
    const r = dep && p.results.get(dep.name);
    return dep && r ? { r, range: new vscode.Range(doc.positionAt(dep.start), doc.positionAt(dep.end)) } : undefined;
  }

  async provideHover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | undefined> {
    const hit = this.resultAt(doc, pos);
    if (!hit) return undefined;
    const explained = await this.loadExplanations(path.dirname(doc.uri.fsPath));
    // Not trusted, no HTML: untrusted text only appears in code spans.
    const md = new vscode.MarkdownString();
    const { r } = hit;
    md.appendMarkdown(`**safe-install: ${r.level.toUpperCase()}**\n\n`);
    const rules = new Set<string>();
    const findingsOf = (pkg: NonNullable<DependencyResult['own']>) => {
      for (const f of pkg.findings) {
        rules.add(f.rule);
        md.appendMarkdown(`- ${codeSpan(f.rule)} ${f.severity}: ${codeSpan(f.message)}\n`);
      }
    };
    if (r.own) {
      md.appendMarkdown(`${codeSpan(r.own.id)} (score ${String(r.own.score)})\n\n`);
      findingsOf(r.own);
    }
    for (const v of r.via) {
      md.appendMarkdown(`\nBrings in ${codeSpan(v.pkg.id)} (${v.pkg.level}) via ${codeSpan(v.path.join(' › '))}\n\n`);
      findingsOf(v.pkg);
    }
    for (const id of rules) {
      const e = explained.get(id);
      if (e) md.appendMarkdown(`\n**${codeSpan(e.id)} ${escape(e.title)}**: ${escape(e.why)} *What to do:* ${escape(e.fix)}\n`);
    }
    return new vscode.Hover(md, hit.range);
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration('safeInstall').get<boolean>('codeLens', true)) return [];
    const p = this.projects.get(path.dirname(doc.uri.fsPath));
    if (!p) return [];
    const lenses: vscode.CodeLens[] = [];
    for (const dep of declaredDependencies(doc.getText())) {
      const r = p.results.get(dep.name);
      if (!r) continue;
      const pos = doc.positionAt(dep.start);
      lenses.push(new vscode.CodeLens(new vscode.Range(pos, pos), { title: lensTitle(r), command: 'workbench.actions.view.problems' }));
    }
    return lenses;
  }

  private loadExplanations(cwd: string): Promise<Map<string, Explanation>> {
    this.explanations ??= this.cli
      .json(['explain', '--format', 'json'], cwd)
      .then((raw) => new Map(parseExplanations(raw).map((e) => [e.id, e])))
      .catch(() => {
        this.explanations = undefined;
        return new Map<string, Explanation>();
      });
    return this.explanations;
  }

  dispose(): void {
    for (const p of this.projects.values()) {
      p.running?.cancel();
      if (p.timer) clearTimeout(p.timer);
    }
    for (const d of this.disposables) d.dispose();
  }
}

// A function, not a property read: the token changes while we await.
function cancelled(token: vscode.CancellationToken): boolean {
  return token.isCancellationRequested;
}

function summary(r: DependencyResult): string {
  const parts: string[] = [];
  if (r.own) parts.push(...r.own.findings.map((f) => `${f.rule} ${f.message}`));
  for (const v of r.via) parts.push(`via ${v.pkg.id}: ${v.pkg.findings.map((f) => f.rule).join(', ')}`);
  return `${r.level.toUpperCase()}: ${parts.join('; ')}`;
}

function lensTitle(r: DependencyResult): string {
  const rules = [...new Set([...(r.own?.findings ?? []), ...r.via.flatMap((v) => v.pkg.findings)].map((f) => f.rule))];
  const first = rules[0] ?? '';
  return `safe-install: ${r.level.toUpperCase()} · ${first}${rules.length > 1 ? ` +${String(rules.length - 1)}` : ''}`;
}

/** Text we wrote ourselves (rule explanations from the CLI) still gets Markdown escaped. */
function escape(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!<>|]/g, '\\$&');
}

function offsetToPosition(text: string): (offset: number) => vscode.Position {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return new vscode.Position(lo, offset - (starts[lo] ?? 0));
  };
}
