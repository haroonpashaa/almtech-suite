import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Recharts is deliberately NOT named here. Naming it produced a chunk that
        // Vite treated as part of the entry graph and emitted a <link rel="modulepreload">
        // for, so the 412 kB of chart code was downloaded on every page load —
        // including the anonymous login screen and screens with no chart at all.
        // Left alone, Rollup reaches it only through the dynamic import in
        // ChartBodies.jsx and it is fetched when a chart is actually rendered.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'axios'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:5050',
    },
  },
});
