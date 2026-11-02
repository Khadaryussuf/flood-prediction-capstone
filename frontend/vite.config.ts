/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The built dashboard is served by Flask: index.html at /dashboard, and the
// assets from Flask's static folder at /static/app/.
const FLASK = 'http://127.0.0.1:5000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/static/app/',
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  build: {
    outDir: '../backend/static/app',
    emptyOutDir: true,
  },
  // npm run dev only: forward API calls to the running Flask server
  server: {
    proxy: {
      '/api': FLASK,
      '/health': FLASK,
      '/predict': FLASK,
      '/predictions': FLASK,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
