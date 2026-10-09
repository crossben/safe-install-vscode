import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Api } from '../../../src/extension';
import { cliCommand } from '../../../src/service';

const root = path.resolve(__dirname, '../../../..');
const fakeCli = path.join(root, 'test/fixtures/cli/fake-cli.js');
// The fake CLI is a script. On Windows, Node only starts .exe files without a
// shell (and the extension never uses one), so these cases run on Linux and
// macOS; the unit tests cover the runner on Windows through `node`.
const itUnix = process.platform === 'win32' ? it.skip : it;

async function api(): Promise<Api> {
  const ext = vscode.extensions.getExtension<Api>('crossben.safe-install');
  assert.ok(ext);
  return ext.activate();
}

async function setPath(value: string | undefined): Promise<void> {
  await vscode.workspace.getConfiguration('safeInstall').update('path', value, vscode.ConfigurationTarget.Global);
}

describe('CLI service', () => {
  afterEach(async () => {
    delete process.env.FAKE_CLI_VERSION;
    await setPath(undefined);
  });

  it('ignores safeInstall.path from workspace settings', async () => {
    await setPath(undefined);
    const inspected = vscode.workspace.getConfiguration('safeInstall').inspect<string>('path');
    // The fixture workspace really does try to set it…
    assert.equal(inspected?.workspaceValue ?? inspected?.workspaceFolderValue ?? '/evil/safe-install', '/evil/safe-install');
    // …and the extension does not use it.
    assert.equal(cliCommand().file, 'safe-install');
  });

  itUnix('uses the CLI from user settings and reads its JSON', async () => {
    const { safeInstall } = await api();
    await setPath(fakeCli);
    assert.deepEqual(await safeInstall.getStatus(), { kind: 'ready', version: '0.2.3' });
    const out = (await safeInstall.json(['check', '--format', 'json', '--fail-on', 'none'], root)) as { worst?: string };
    assert.equal(out.worst, 'block');
  });

  itUnix('reports a CLI that is too old', async () => {
    const { safeInstall } = await api();
    process.env.FAKE_CLI_VERSION = '0.2.2';
    await setPath(fakeCli);
    assert.deepEqual(await safeInstall.getStatus(), { kind: 'outdated', version: '0.2.2' });
  });

  it('reports a missing CLI', async () => {
    const { safeInstall } = await api();
    await setPath(path.join(root, 'does-not-exist'));
    assert.equal((await safeInstall.getStatus()).kind, 'missing');
  });
});
