import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'out', '.vscode-test', 'test/fixtures', '*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ['./tsconfig.test.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Spawning processes goes through one audited wrapper (src/cli.ts, E2).
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'child_process', message: 'Use node:child_process via src/cli.ts.' }] },
      ],
    },
  },
);
