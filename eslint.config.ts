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
  files: ['src/**/*.{ts,tsx}'],
  ignores: [
    'src/**/server/**',
    'src/**/*.fn.ts',
    'src/**/*.test.{ts,tsx}',
    'src/routes/api.*.ts',
  ],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/server/**'],
        message: '浏览器代码不得导入 server 模块；请通过 server function 或 API 调用。',
      }],
    }],
  },
}, {
  files: ['src/routes/**/*.{ts,tsx}'],
  rules: {
    // TanStack file routes must export Route alongside their route component.
    'react-refresh/only-export-components': 'off',
  },
});
