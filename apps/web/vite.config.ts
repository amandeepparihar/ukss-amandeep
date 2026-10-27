import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['cal-heatmap', 'react-leaflet', 'leaflet'],
  },
  server: {
    port: 3002,
    host: '0.0.0.0',
    allowedHosts: ['js-admin.veldev.com', 'localhost'],
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
