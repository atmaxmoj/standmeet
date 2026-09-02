import { defineConfig } from 'tsup';

// @standmeet/sdk React wrapper: reuses sdk-core's fetch + SSE, and adds the
// useStandMeetClient context hook so Next / any React app can get the client instance.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['react', 'react-dom'],
  treeshake: true,
  splitting: false,
});
