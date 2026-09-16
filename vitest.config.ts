import { defineConfig } from 'vitest/config';
import viteReact from '@vitejs/plugin-react';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [viteReact()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    pool: 'forks',
  },
})
