import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Api } from '../../../src/extension';

/** Runs in a VS Code launched without trusting the folder (Restricted Mode). */
export async function run(): Promise<void> {
  assert.equal(vscode.workspace.isTrusted, false, 'the folder should not be trusted');
  const ext = vscode.extensions.getExtension<Api>('crossben.safe-install');
  assert.ok(ext);
  const { safeInstall } = await ext.activate();
  const fake = path.resolve(__dirname, '../../../../test/fixtures/cli/fake-cli.js');
  await vscode.workspace.getConfiguration('safeInstall').update('path', fake, vscode.ConfigurationTarget.Global);
  assert.deepEqual(await safeInstall.getStatus(), { kind: 'untrusted' });
  assert.equal(await safeInstall.json(['check', '--format', 'json'], process.cwd()), undefined);
  console.log('untrusted: nothing ran');
}
