import * as path from 'node:path';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // Set when this runs from a terminal inside VS Code; it would make the test
  // build start as plain Node instead of as an editor.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const root = path.resolve(__dirname, '../../..');
  // A fresh profile per run, so user settings written by tests never leak.
  const profile = (): string => mkdtempSync(path.join(tmpdir(), 'si-vscode-'));

  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.resolve(__dirname, 'suite'),
    launchArgs: [
      path.join(root, 'test/fixtures/workspace'),
      '--disable-extensions',
      '--disable-workspace-trust',
      `--user-data-dir=${profile()}`,
    ],
  });

  // Restricted Mode: trust is on and this folder was never trusted. It is
  // copied outside the extension, whose own folder VS Code trusts in development.
  const untrusted = mkdtempSync(path.join(tmpdir(), 'si-untrusted-'));
  copyFileSync(path.join(root, 'test/fixtures/untrusted/package.json'), path.join(untrusted, 'package.json'));
  const restricted = profile();
  mkdirSync(path.join(restricted, 'User'), { recursive: true });
  writeFileSync(
    path.join(restricted, 'User', 'settings.json'),
    JSON.stringify({ 'security.workspace.trust.enabled': true, 'security.workspace.trust.startupPrompt': 'never' }),
  );
  // runTests always adds --disable-workspace-trust, so launch this one directly
  // with the same arguments minus that flag.
  const code = spawnSync(
    await downloadAndUnzipVSCode(),
    [
      untrusted,
      '--disable-extensions',
      `--user-data-dir=${restricted}`,
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--no-cached-data',
      `--extensionTestsPath=${path.resolve(__dirname, 'untrusted')}`,
      `--extensionDevelopmentPath=${root}`,
    ],
    { stdio: 'inherit' },
  ).status;
  if (code !== 0) throw new Error(`Restricted Mode tests failed (exit ${String(code)})`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
