import { readFile } from 'node:fs/promises';

import { defineConfig } from 'tsup';
import type { Plugin } from 'esbuild';

// stripTestIds —— in the production release build (STRIP_TEST_HOOKS=1) remove data-testid JSX
// attributes from the widgets, so no testid ships in a visitor's HTML — the same policy the app's
// Next build applies to its own JSX (next.config reactRemoveProperties). Dev / CI builds keep them
// for e2e. This runs at the tsup layer because the app imports the SDK as compiled dist, where the
// testids are already object properties the app's JSX-level strip can no longer reach.
//
// The match anchors on `data-testid=` and takes a "..." string or a {...} expression (one level of
// nested braces, enough for a `${…}` template). The release-assert-stripped gate scans the bundle
// afterward, so a missed form fails the release rather than silently leaking.
const STRIP = /\s+data-testid=(?:"[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\})/g;

const stripTestIdPlugin: Plugin = {
  name: 'strip-testid',
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const src = await readFile(args.path, 'utf8');
      return { contents: src.replace(STRIP, ''), loader: 'tsx' };
    });
  },
};

const stripping = process.env['STRIP_TEST_HOOKS'] === '1';

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
  esbuildPlugins: stripping ? [stripTestIdPlugin] : [],
});
