import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@standmeet/components': path.resolve(__dirname, './components'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://server:8000',
    },
    watch: {
      usePolling: true,
    },
  },
  build: {
    outDir: 'dist',
    // In build mode, use source/index.html (created by build.mjs).
    // In dev mode (serve), use root index.html (entry-dev.tsx).
    ...(command === 'build' ? {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'source/index.html'),
        },
      },
    } : {}),
  },
}));
