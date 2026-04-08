import tseslint from 'typescript-eslint';
import sveltePlugin from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '*.min.js'],
  },
  ...tseslint.configs.strict,
  ...sveltePlugin.configs['flat/recommended'],
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message: 'Use design tokens from tokens.ts — no raw hex values.',
        },
      ],
    },
  },
  {
    files: ['src/lib/tokens.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
