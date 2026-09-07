import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const WS_PORT = parseInt(process.env.WS_PORT || '8080', 10);
const VITE_PORT = parseInt(process.env.VITE_DEV_PORT || '5173', 10);
const GV_ANALYTICS_PORT = parseInt(process.env.GV_ANALYTICS_PORT || '4754', 10);

export default defineConfig({
  plugins: [react()],
  server: {
    port: VITE_PORT,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://localhost:${WS_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `http://localhost:${WS_PORT}`,
        ws: true,
      },
      // Proxy gv-analytics API (port 4754) so the dashboard widget can read
      // "últimos análisis" without CORS. Paths: /gv-analytics/api/* -> :4754/api/*
      '/gv-analytics': {
        target: `http://127.0.0.1:${GV_ANALYTICS_PORT}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gv-analytics/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll('\\', '/');
          if (
            normalizedId.includes('/node_modules/react/') ||
            normalizedId.includes('/node_modules/react-dom/') ||
            normalizedId.includes('/node_modules/react-router-dom/')
          ) {
            return 'vendor';
          }
          if (normalizedId.includes('/node_modules/recharts/')) {
            return 'charts';
          }
          if (normalizedId.includes('/node_modules/lucide-react/')) {
            return 'icons';
          }
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
});
