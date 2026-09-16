import antfu from '@antfu/eslint-config';

export default antfu({
  stylistic: {
    semi: true,
    indent: 2,
    quotes: 'single',
  },
  react: true,
  ignores: [
    'docs/**',
    'src/routeTree.gen.ts',
  ],
}, {
  files: ['**/*.{ts,tsx}'],
  rules: {
    'node/prefer-global/buffer': 'off',
    'node/prefer-global/process': 'off',
    'style/max-statements-per-line': 'off',
    'style/multiline-ternary': 'off',
    // These checks narrow unknown request values; Array.prototype.includes cannot.
    'unicorn/prefer-includes': 'off',
  },
}, {
  files: ['src/routes/**/*.{ts,tsx}'],
  rules: {
    // TanStack file routes must export Route alongside their route component.
    'react-refresh/only-export-components': 'off',
  },
}, {
  files: [
    'src/components/motion/theme-toggle.tsx',
    'src/components/ui/button.tsx',
  ],
  rules: {
    // These component files intentionally co-locate their public hook or variants helper.
    'react-refresh/only-export-components': 'off',
  },
});
