import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/routeTree.gen.ts', 'services/**', 'design/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
