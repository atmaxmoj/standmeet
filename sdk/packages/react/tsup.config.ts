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
  // No rollup tree-shake pass: it strips the 'use client' banner below. esbuild already drops dead
  // code, and the host's bundler tree-shakes again.
  treeshake: false,
  // splitting —— the chat's heavy renderers (mermaid, sanitize-html behind StaticHtmlBlock) are
  // lazy imports; without code splitting esbuild inlines them and every microsite would carry them.
  splitting: true,
  // The chat's stylesheet (src/chat/chat.css + the *.module.css it uses) is emitted as
  // dist/index.css, published as '@standmeet/sdk/styles.css'; its `@import 'katex/…'` stays an
  // import the host resolves from this package's own katex dependency.
  //
  // 'use client' —— everything here is a React client component or hook (state, effects, browser
  // storage). Bundling drops each source file's own directive, so the output states it once: a
  // Next server component (the app's output page renders ChatMarkdown) then renders these as
  // client components, which is what they are.
  banner: { js: "'use client';" },
  esbuildPlugins: stripping ? [stripTestIdPlugin] : [],
});
