// copy-mermaid —— puts mermaid's own ESM build into public/vendor/mermaid/, so this instance serves it
// and the chat loads it from here only when an answer carries a diagram (sdk chat/mermaid-render.ts).
//
// Why not bundle it: as a lazy chunk of @standmeet/sdk it was a hundred-odd files that every
// microsite build had to process (the builder's vite step went from ~2s to ~40s) and megabytes in
// the embed. Served once from the instance, the app, every microsite and the embed share one copy.
//
// Why serve it ourselves instead of a CDN: this is a self-hosted product (same reasoning as
// tikz-fonts). This runs as part of the build, so the served copy always matches node_modules.

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve('mermaid/package.json')), 'dist');
const dest = join(import.meta.dirname, '..', 'public', 'vendor', 'mermaid');

await rm(dest, { recursive: true, force: true });
await mkdir(join(dest, 'chunks'), { recursive: true });
// mermaid.esm.min.mjs imports ./chunks/mermaid.esm.min/*.mjs by relative path: keep the layout.
await cp(join(dist, 'mermaid.esm.min.mjs'), join(dest, 'mermaid.esm.min.mjs'));
await cp(join(dist, 'chunks', 'mermaid.esm.min'), join(dest, 'chunks', 'mermaid.esm.min'), { recursive: true });
// expose.mjs —— what the chat's module <script> loads: mermaid, handed over on window (the chat
// can't import() a run-time URL without every bundler on the way trying to resolve it).
await writeFile(
  join(dest, 'expose.mjs'),
  "import mermaid from './mermaid.esm.min.mjs';\nwindow.__standmeetMermaid = mermaid;\n",
);

console.log(`[mermaid] ${dist} → public/vendor/mermaid/`);
