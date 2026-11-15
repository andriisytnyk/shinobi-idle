import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Browser, time and randomness APIs that the game core must never touch. */
const CORE_FORBIDDEN_GLOBALS = [
  'Date',
  'performance',
  'window',
  'document',
  'setTimeout',
  'setInterval',
].map((name) => ({
  name,
  message: `packages/core must stay pure: "${name}" is forbidden. Time and randomness come from the caller.`,
}));

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    // Local working copies of automation agents; never part of the project.
    '.claude/**',
    'docs/**',
    'packages/content/src/packs/core/data/generated/**',
    'apps/web/src/lib/icons.generated.ts',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  svelte.configs['flat/recommended'],
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] },
    },
  },
  {
    files: ['apps/web/**/*.{ts,svelte}'],
    languageOptions: {
      // `__APP_VERSION__` and `__BUILD_DATE__` are injected by Vite `define`.
      globals: { ...globals.browser, __APP_VERSION__: 'readonly', __BUILD_DATE__: 'readonly' },
    },
  },
  {
    // Architecture rule 1: the core is deterministic and knows nothing about the platform.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...CORE_FORBIDDEN_GLOBALS],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'packages/core must stay pure: use the seeded rng streams instead of Math.random.',
        },
      ],
    },
  },
);
