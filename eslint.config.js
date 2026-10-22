import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'node_modules/**', 'coverage/**'] },
  ...tseslint.configs.strictTypeChecked.map((c) => ({ ...c, files: ['**/*.ts'] })),
  ...tseslint.configs.stylisticTypeChecked.map((c) => ({ ...c, files: ['**/*.ts'] })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.check.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:child_process',
              message: 'Only toolkit/src/platform/process.ts owns process spawning.',
              allowTypeImports: true,
            },
            { name: 'node:sqlite', message: 'Only evidence/src/db/ owns SQLite.', allowTypeImports: true },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/toolkit/src/platform/process.ts', 'packages/evidence/src/db/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
