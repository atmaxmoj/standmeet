// copy-typst-assets —— stage the typst.ts WASM + the résumé .typ templates into public/, so the
// composer's in-browser preview (docs/design/composer-visual-editor.md) can load them same-origin.
//
// Two kinds of asset, both self-hosted (this is a self-hosted product; no CDN — same reasoning as
// copy-embed-bundle / tikz-fonts):
//   - the typst.ts compiler + renderer WASM (from node_modules) → /typst/*.wasm
//   - the SAME .typ templates the server `typst` binary renders (from backend/.../resumepdf/
//     templates) → /typst/templates/*.typ, so the WASM compiles byte-identical layouts (no drift).
//
// Runs in dev + prebuild, so what the browser compiles always matches this repo's templates + the
// pinned typst.ts version.

import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const APP_DIR = join(import.meta.dirname, '..');
const OUT = join(APP_DIR, 'public', 'typst');
const TEMPLATES_SRC = join(
  APP_DIR, '..', 'backend', 'internal', 'owner', 'jobs', 'resumepdf', 'templates',
);
const WASM = [
  ['@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm',
    'typst_ts_web_compiler_bg.wasm'],
  ['@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm',
    'typst_ts_renderer_bg.wasm'],
];

await mkdir(OUT, { recursive: true });
await mkdir(join(OUT, 'templates'), { recursive: true });

for (const [rel, name] of WASM) {
  const src = join(APP_DIR, 'node_modules', rel);
  await copyFile(src, join(OUT, name));
  console.log(`[typst] ${name}`);
}

const typs = (await readdir(TEMPLATES_SRC)).filter((f) => f.endsWith('.typ'));
for (const f of typs) {
  await copyFile(join(TEMPLATES_SRC, f), join(OUT, 'templates', f));
  console.log(`[typst] templates/${f}`);
}
