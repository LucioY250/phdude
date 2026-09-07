import js from '@eslint/js';
export default [
  js.configs.recommended,
  { ignores: ['node_modules/**', 'examples/**', 'tests/fixtures/**'] },
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' },
    },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
];
