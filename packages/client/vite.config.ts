import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The client runs on :5173 in dev; the API runs on :3000.
// Proxying /api/* to the server keeps browser requests same-origin (no CORS).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Strip the /api prefix before forwarding: /api/health → /health.
        // The prefix is just a browser-side namespace so Vite knows what to proxy.
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
