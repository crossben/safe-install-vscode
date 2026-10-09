import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Api } from '../../../src/extension';

const root = path.resolve(__dirname, '../../../..');
const fakeCli = path.join(root, 'test/fixtures/cli/fake-cli.js');
const manifest = vscode.Uri.file(path.join(root, 'test/fixtures/workspace/package.json'));
// Scripts can only be started without a shell on Linux and macOS (see cli.test.ts).
const describeUnix = process.platform === 'win32' ? describe.skip : describe;

async function checked(): Promise<Api> {
  const ext = vscode.extensions.getExtension<Api>('crossben.safe-install');
  assert.ok(ext);
  const api = await ext.activate();
  await vscode.workspace.getConfiguration('safeInstall').update('path', fakeCli, vscode.ConfigurationTarget.Global);
  await api.checker.checkAll();
  await api.checker.idle;
  return api;
}

describeUnix('dependency markers', () => {
  afterEach(async () => {
    delete process.env.FAKE_CLI_MODE;
    await vscode.workspace.getConfiguration('safeInstall').update('path', undefined, vscode.ConfigurationTarget.Global);
  });

  it('marks a malicious dependency in package.json', async () => {
    await checked();
    const diags = vscode.languages.getDiagnostics(manifest).filter((d) => d.source === 'safe-install');
    assert.equal(diags.length, 1, JSON.stringify(diags));
    const [d] = diags;
    assert.ok(d);
    assert.equal(d.severity, vscode.DiagnosticSeverity.Error);
    assert.match(d.message, /^BLOCK: /);
    const doc = await vscode.workspace.openTextDocument(manifest);
    assert.equal(doc.getText(d.range), 'lodahs');
  });

  it('explains it on hover, from the CLI', async () => {
    await checked();
    const doc = await vscode.workspace.openTextDocument(manifest);
    const pos = doc.positionAt(doc.getText().indexOf('lodahs') + 2);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', manifest, pos);
    const text = hovers.flatMap((h) => h.contents.filter((c) => c instanceof vscode.MarkdownString).map((c) => c.value)).join('\n');
    assert.match(text, /safe-install: BLOCK/);
    assert.match(text, /SI-POP-001/);
    assert.match(text, /What to do:/);
  });

  it('keeps hostile finding text inert in the hover', async () => {
    process.env.FAKE_CLI_MODE = 'hostile';
    await checked();
    const doc = await vscode.workspace.openTextDocument(manifest);
    const pos = doc.positionAt(doc.getText().indexOf('lodahs') + 2);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', manifest, pos);
    const md = hovers
      .flatMap((h) => h.contents)
      .filter((c) => c instanceof vscode.MarkdownString)
      .find((c) => c.value.includes('command:'));
    assert.ok(md, 'hostile message not shown at all');
    assert.ok(!md.isTrusted, 'hover must not be trusted');
    assert.ok(!md.supportHtml, 'hover must not render HTML');
    // Outside code spans, none of the hostile text may appear.
    const outside = md.value.split('`').filter((_, i) => i % 2 === 0).join('');
    for (const bad of ['](', '<img', 'command:']) assert.ok(!outside.includes(bad), `${bad} outside a code span:\n${md.value}`);
  });
});

describeUnix('quick fixes', () => {
  afterEach(async () => {
    await vscode.workspace.getConfiguration('safeInstall').update('path', undefined, vscode.ConfigurationTarget.Global);
  });

  it('offers "why" and "explain" on a marked dependency', async () => {
    await checked();
    const [d] = vscode.languages.getDiagnostics(manifest).filter((x) => x.source === 'safe-install');
    assert.ok(d);
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', manifest, d.range);
    const titles = actions.map((a) => a.title);
    assert.ok(titles.includes('Why is lodahs here? (safe-install)'), titles.join(', '));
    assert.ok(titles.some((t) => /^Explain SI-[A-Z]+-\d{3} \(safe-install\)$/.test(t)), titles.join(', '));
  });
});
