import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

// Every suppression must say why, so a non-null assertion (or any other
// escape hatch) can only land with a written justification.
const requireDisableReason = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      missing: 'eslint-disable needs a reason: append "-- <why this is safe>".',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const text = comment.value.trim()
          if (/^eslint-disable(-next-line|-line)?(\s|$)/.test(text) && !/\s--\s*\S/.test(text)) {
            context.report({ loc: comment.loc, messageId: 'missing' })
          }
        }
      },
    }
  },
}

const banDexie = {
  regex: '^dexie(/|$)',
  message: 'Only src/storage/db.ts and src/storage/repository.ts may import Dexie.',
}
const banDbFromOutside = {
  regex: '(^|/)storage/db(\\.ts)?$',
  message: 'Only src/storage/repository.ts may import storage/db.ts.',
}
const banDbSibling = {
  regex: '^\\./db(\\.ts)?$',
  message: 'Only src/storage/repository.ts may import storage/db.ts.',
}
const banUi = {
  regex: '(^|/)ui(/|$)',
  message: 'Only src/ui/ and src/app.tsx may import from ui/.',
}

const enginePurity = 'Engines are pure: plain data in, plain data out, imports from schema/ only.'
const banEngineLayers = { regex: '(^|/)(storage|hooks|render|ui)(/|$)', message: enginePurity }
const banEngineRuntimes = { regex: '^(react|react-dom|dexie)(/|$)', message: enginePurity }
const injectedClock = 'Engines take the current time as an injected input.'

// Flat config replaces, not merges, a rule's options when several blocks match
// one file, so each block restates the full pattern list for its files.
const restrictImports = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
})

export default defineConfig(
  { ignores: ['dist/', 'coverage/'] },
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      local: { rules: { 'require-disable-reason': requireDisableReason } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'local/require-disable-reason': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: restrictImports(banDexie, banDbFromOutside, banUi),
  },
  {
    files: ['src/ui/**/*.{ts,tsx}', 'src/app.tsx'],
    rules: restrictImports(banDexie, banDbFromOutside),
  },
  {
    files: ['src/storage/**/*.{ts,tsx}'],
    rules: restrictImports(banDexie, banDbFromOutside, banDbSibling, banUi),
  },
  {
    files: ['src/storage/db.ts', 'src/storage/repository.ts'],
    rules: restrictImports(banUi),
  },
  {
    files: ['src/engines/**/*.{ts,tsx}'],
    rules: {
      ...restrictImports(banEngineRuntimes, banEngineLayers),
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'navigator',
          'localStorage',
          'sessionStorage',
          'indexedDB',
          'fetch',
          'XMLHttpRequest',
          'performance',
        ].map((name) => ({ name, message: enginePurity })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: injectedClock },
        { object: 'Math', property: 'random', message: 'Engines must be deterministic.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: injectedClock },
        { selector: "CallExpression[callee.name='Date']", message: injectedClock },
      ],
    },
  },
)
