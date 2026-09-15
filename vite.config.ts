import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { codeInspectorPlugin } from 'code-inspector-plugin';
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: {
    tsconfigPaths: true
  },
  plugins: [
    codeInspectorPlugin({
      bundler: 'vite',
      lang: 'zh',
      editor: 'code',
    }),
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact()
  ],
})

export default config
