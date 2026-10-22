import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        output: {
          format: 'es',
          entryFileNames: '[name].mjs',
          chunkFileNames: 'chunks/[name]-[hash].mjs'
        },
        input: {
          index: resolve('src/main/index.ts'),
          runtime: resolve('src/runtime/entry.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
