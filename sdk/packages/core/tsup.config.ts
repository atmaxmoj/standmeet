import { defineConfig } from 'tsup';

// @standmeet/sdk-core is the UI-less core: API client, types, state machine.
// ESM-only, .d.ts output, tree-shake on, splitting off — keeps dist/ flat
// and the package.json exports map simple.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  treeshake: true,
  splitting: false,
});
