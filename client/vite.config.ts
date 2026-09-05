import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxying /api through Vite keeps the browser's view same-origin in dev,
// so cookies flow without any CORS credentials dance (see server/index.js
// comments for why this matters once you deploy cross-origin).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
