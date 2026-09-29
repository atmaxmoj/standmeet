import { defineConfig } from 'tsup';

// @standmeet/embed — the Web Component for any site: one <script>, and <standmeet-chat> renders the
// SDK's own chat (<Agent>) inside a shadow root. Self-contained: React, the SDK and its stylesheet
// (as text, injected into the shadow root) are bundled in, since the host page has none of them.
export default defineConfig({
  entry: { embed: 'src/embed.ts' },
  format: ['esm', 'iife'],
  globalName: 'StandMeetEmbed',
  dts: true,
  clean: true,
  splitting: false,
  minify: true,
  // The browser builds of dependencies (vfile's own `path`/`process` shims): tsup defaults to Node,
  // and a bundle that requires Node's `path` throws on load in a host page.
  platform: 'browser',
  noExternal: [/.*/],
  // Two stand-ins, because an IIFE cannot split a lazy chunk off:
  //  · mermaid (megabytes) would ride along on every host page (src/no-mermaid.ts);
  //  · sanitize-html pulls postcss, which requires Node's `path` and throws on load
  //    (src/no-sanitize-html.ts: an owner's standmeet-html block renders as nothing).
  // ponytail: diagrams and pre-baked HTML don't render in the embed; lazy-load them from the
  // instance if that matters.
  esbuildOptions(options) {
    options.alias = { mermaid: './src/no-mermaid.ts', 'sanitize-html': './src/no-sanitize-html.ts' };
  },
  loader: { '.css': 'text' },
  // The React build without dev checks: this ships to other people's pages.
  define: { 'process.env.NODE_ENV': '"production"' },
});
