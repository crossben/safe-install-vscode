import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const noChildProcess = {
  'no-restricted-imports': [
    'error',
    {
      paths: ['child_process', 'node:child_process'].map((name) => ({
        name,
        message: 'Start processes only through src/cli.ts (no shell, timeouts, output caps).',
      })),
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist', 'out', '.vscode-test', 'test/fixtures', '*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ['./tsconfig.test.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: noChildProcess,
  },
  // The two places allowed to start processes.
  { files: ['src/cli.ts', 'test/integration/runTest.ts'], rules: { 'no-restricted-imports': 'off' } },
);
