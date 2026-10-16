import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Dev server on :5173 (matches backend CORS + docs)
// /api is proxied to FastAPI at :8000 so the dashboard works with a
// relative baseURL (no CORS, no hardcoded host in dev).
const apiProxy = {
  target: 'http://127.0.0.1:8000',
  changeOrigin: true,
}

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': apiProxy,
    },
  },
  preview: {
    port: 5173,
    proxy: {
      '/api': apiProxy,
    },
  },
})
