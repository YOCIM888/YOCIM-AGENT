import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(root, 'src/shared'),
      '@renderer': resolve(root, 'src/renderer/src')
    }
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/bench/**/*.test.ts'],
    environment: 'node',
    reporters: ['default']
  }
})
