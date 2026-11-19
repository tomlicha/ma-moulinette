// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Architecture en couches (docs/architecture.md) : une couche n'importe que des couches inférieures.
 *
 *   shared  <  domain  <  infra  <  app  <  ui, render        (main.ts, la racine de composition, importe tout)
 *
 * `src/server` (le Worker) est à part : il n'a rien à faire de l'interface, du rendu ni de l'application.
 * Chaque règle interdit les couches « au-dessus » du dossier concerné. Niveau `error` : la CI refuse un import qui
 * remonte. `src/integration` (tests qui traversent les couches) n'est soumis à aucune règle.
 */
const layer = (name) => `(^|/)${name}/`;
const forbid = (...names) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: names.map((n) => ({
        regex: layer(n),
        message: `Dépendance interdite : cette couche ne doit pas importer « ${n} » (voir docs/architecture.md).`,
      })),
    },
  ],
});
const LAYER_RULES = [
  { files: ['src/shared/**/*.ts'], rules: forbid('domain', 'infra', 'app', 'ui', 'render', 'server') },
  { files: ['src/domain/**/*.ts'], rules: forbid('infra', 'app', 'ui', 'render', 'server') },
  { files: ['src/infra/**/*.ts'], rules: forbid('app', 'ui', 'render', 'server') },
  { files: ['src/app/**/*.ts'], rules: forbid('ui', 'server') },
  { files: ['src/render/**/*.ts'], rules: forbid('app', 'ui', 'server') },
  { files: ['src/ui/**/*.ts'], rules: forbid('server') },
  { files: ['src/server/**/*.ts'], rules: forbid('app', 'ui', 'render') },
];

/**
 * Règles recommandées, plus celles qui comptent ici : l'application vit de promesses (Bluetooth, envois au
 * trainer, export) ; une promesse oubliée, c'est une erreur qui disparaît sans laisser de trace.
 */
export default tseslint.config(
  {
    // Les scripts .js/.mjs/.cjs (outils, service worker, ios) tournent hors du projet TypeScript : non vérifiés ici.
    ignores: ['dist/**', 'node_modules/**', '.claude/**', 'public/**', '.wrangler/**', 'ios/**', 'tools/preview/**', '**/*.{js,cjs,mjs}'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { project: ['./tsconfig.json', './tsconfig.node.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Espaces insécables voulus dans les textes (typographie française : « 18 km », « 12 % »).
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  ...LAYER_RULES,
);
