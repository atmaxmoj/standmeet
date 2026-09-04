import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base='./' lets the dist work under any URL prefix the backend uses.
// tailwindcss(): every owner page gets the StandMeet design system (tokens + fonts) via
// src/theme.css, so a custom page can be styled exactly like the app rather than starting bare.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
  },
});
