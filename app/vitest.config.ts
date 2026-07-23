// vitest.config.ts —— unit tests for reusable render/toolbox primitives (not a replacement for the
// e2e suite; scoped to pure, framework-shaped units like the markdown → HTML render pipeline where a
// fast, headless assertion is the right guard). Node env: components are exercised via
// renderToStaticMarkup (no DOM needed). CSS-module imports resolve to a key→name proxy so component
// modules import cleanly without a real stylesheet.
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
