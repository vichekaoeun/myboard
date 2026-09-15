import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2020' },
  // Local dev: proxy the Worker API (and its WebSocket) so the SPA on :5173
  // shares an origin with the backend on :8787.
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true, ws: true },
    },
  },
})