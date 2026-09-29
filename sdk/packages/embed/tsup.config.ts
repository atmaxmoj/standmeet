import { defineConfig } from 'tsup';

// @standmeet/embed — the Web Component for any site. Two outputs:
//  · dist/loader.global.js —— the one `<script src>` a host page adds (served as /embed.js): it only
//    imports the chat from beside it;
//  · dist/esm/ —— the chat itself (served under /embed/): <standmeet-chat>, which renders the SDK's
//    <Agent> in a shadow root. Self-contained (React, the SDK and its stylesheet as text are bundled
//    in — the host page has none of them) and code-split, so diagrams and pre-baked HTML load only
//    when an answer carries one.
export default defineConfig([
  {
    entry: { loader: 'src/loader.ts' },
    format: ['iife'],
    outDir: 'dist',
    // Not clean: dist/esm (the other build) lives inside dist.
    clean: false,
    minify: true,
    platform: 'browser',
  },
  {
    entry: { embed: 'src/embed.ts' },
    format: ['esm'],
    outDir: 'dist/esm',
    clean: true,
    dts: true,
    splitting: true,
    minify: true,
    platform: 'browser',
    noExternal: [/.*/],
    loader: { '.css': 'text' },
    // The React build without dev checks: this ships to other people's pages.
    define: { 'process.env.NODE_ENV': '"production"' },
  },
]);
