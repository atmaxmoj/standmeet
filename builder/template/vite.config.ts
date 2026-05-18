import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base='./' lets the dist work under any URL prefix the backend uses.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
  },
});
