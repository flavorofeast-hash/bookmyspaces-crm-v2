import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src'), 'server-only': path.resolve(__dirname, './tests/stubs/empty.ts') } },
})
