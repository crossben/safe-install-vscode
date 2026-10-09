import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Api } from '../../../src/extension';

const root = path.resolve(__dirname, '../../../..');
const fakeCli = path.join(root, 'test/fixtures/cli/fake-cli.js');
const project = path.join(root, 'test/fixtures/workspace');
const describeUnix = process.platform === 'win32' ? describe.skip : describe;

async function view(mode = ''): Promise<Api['scripts']> {
  const ext = vscode.extensions.getExtension<Api>('crossben.safe-install');
  assert.ok(ext);
  const { scripts } = await ext.activate();
  if (mode) process.env.FAKE_CLI_MODE = mode;
  await vscode.workspace.getConfiguration('safeInstall').update('path', fakeCli, vscode.ConfigurationTarget.Global);
  scripts.setProjects([project]);
  await scripts.refresh();
  return scripts;
}

describeUnix('install scripts view', () => {
  let confirmed: string[] = [];
  let refused: string[] = [];

  afterEach(async () => {
    delete process.env.FAKE_CLI_MODE;
    confirmed = [];
    refused = [];
    for (const t of vscode.window.terminals) t.dispose();
    await vscode.workspace.getConfiguration('safeInstall').update('path', undefined, vscode.ConfigurationTarget.Global);
  });

  function stub(scripts: Api['scripts'], answer: boolean): void {
    scripts.confirm = (message) => {
      confirmed.push(message);
      return Promise.resolve(answer);
    };
    scripts.refuse = (message) => {
      refused.push(message);
      return Promise.resolve();
    };
  }

  it('lists packages waiting for approval', async () => {
    const scripts = await view();
    const [group] = scripts.getChildren();
    assert.ok(group);
    assert.equal(scripts.getTreeItem(group).label, 'Needs your approval (1)');
    const [pkg] = scripts.getChildren(group);
    assert.ok(pkg);
    const item = scripts.getTreeItem(pkg);
    assert.equal(item.label, 'esbuild@0.25.10');
    assert.equal(item.contextValue, 'safeInstall.pkg.pending');
    assert.deepEqual(scripts.getChildren(pkg).map((n) => scripts.getTreeItem(n).label), ['postinstall: node install.js']);
  });

  it('runs nothing when the user cancels', async () => {
    const scripts = await view();
    stub(scripts, false);
    const [target] = scripts.packages();
    assert.equal(await scripts.approve(target), undefined);
    assert.equal(confirmed.length, 1);
    assert.equal(vscode.window.terminals.length, 0);
  });

  it('on yes, runs `safe-install approve <name>` directly in a visible terminal', async () => {
    const scripts = await view();
    stub(scripts, true);
    const terminal = await scripts.approve(scripts.packages()[0]);
    assert.ok(terminal);
    const opts = terminal.creationOptions as vscode.TerminalOptions;
    assert.equal(opts.shellPath, fakeCli); // the CLI itself: no shell in between
    assert.deepEqual(opts.shellArgs, ['approve', 'esbuild']);
    assert.equal(opts.cwd, project);
  });

  it('never approves high-risk scripts', async () => {
    const scripts = await view('scripts-high');
    stub(scripts, true);
    assert.equal(await scripts.approve(scripts.packages()[0]), undefined);
    assert.equal(confirmed.length, 0);
    assert.match(refused[0] ?? '', /does not approve high-risk/);
    assert.equal(vscode.window.terminals.length, 0);
  });

  it('refuses a package name that is a flag', async () => {
    const scripts = await view('scripts-hostile');
    stub(scripts, true);
    await assert.rejects(scripts.approve(scripts.packages()[0]), /not a package name/);
    assert.equal(vscode.window.terminals.length, 0);
  });
});
