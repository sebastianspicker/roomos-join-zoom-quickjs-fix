import js from '@eslint/js';
import globals from 'globals';

// Files at the repo root other than this config are RoomOS macros: they run on the
// device (QuickJS on RoomOS 11.28+), not in Node or a browser.
const MACROS = ['Memory_Functions.js', 'JoinZoom_Main_4-1-1.js'];

export default [
  {
    ignores: ['node_modules/**']
  },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': 'warn',
      'eqeqeq': ['error', 'always']
    }
  },
  {
    files: MACROS,
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        globalThis: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        module: 'readonly' // legacy runtime fallback for the macro name
      }
    },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '^(?!xapi$|\\./[^/]+$)',
          message: "Macros may import only 'xapi' and sibling macros ('./<MacroName>')."
        }]
      }]
    }
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    }
  }
];
