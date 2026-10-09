import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

describe('activation', () => {
  it('activates in a folder with a package.json', async () => {
    const ext = vscode.extensions.getExtension('crossben.safe-install');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    assert.equal(ext.isActive, true);
  });
});
