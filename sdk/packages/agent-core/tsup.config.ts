import { defineConfig } from 'tsup';

// @standmeet/agent-core is the pure-TS core of the visitor chat agent loop.
// It pulls in no HTTP / fs / DOM / Node APIs — behavior is fully determined by
// the 5 ports the caller injects.
// The same code and system prompt run in prod browser / Node eval harness / any host.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  treeshake: true,
  splitting: false,
});
