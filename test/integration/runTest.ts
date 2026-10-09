import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // Set when this runs from a terminal inside VS Code; it would make the test
  // build start as plain Node instead of as an editor.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const root = path.resolve(__dirname, '../../..');
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.resolve(__dirname, 'suite'),
    launchArgs: [
      path.join(root, 'test/fixtures/workspace'),
      '--disable-extensions',
      '--disable-workspace-trust',
    ],
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
