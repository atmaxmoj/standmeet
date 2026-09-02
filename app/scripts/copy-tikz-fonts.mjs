// copy-tikz-fonts —— moves the TeX fonts bundled with node-tikzjax into public/,
// so this instance serves them itself.
//
// Why serving them is required: in the SVG tikzjax outputs, text is `<text>` +
// `font-family: cmr10 / cmsy10 / …` — the characters are **TeX font glyph slots**,
// not Unicode. `$\to$` lands at 0x21 in cmsy10 — which is `!`.
// If the font doesn't load, the browser falls back to a system font, the arrow
// turns into an exclamation mark on the spot, kerning is laid out by the wrong
// metrics, and words get split apart.
//
// Why serve it ourselves instead of using its default: `fontCssUrl` defaults to
// pointing at the jsDelivr CDN. This is a **self-hosted** product — an offline
// install can't reach it, and every diagram would send one more request to a
// third party on behalf of the owner's readers.
//
// This runs as part of the build, so the fonts always match the node_modules
// version (hand-vendoring into the repo would silently go stale).

import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('node-tikzjax/package.json'));
const src = join(pkgDir, 'css');
const dest = join(import.meta.dirname, '..', 'public', 'tikz-fonts');

// fonts.css references bakoma/ttf/*.ttf by relative path, so the whole css/
// directory is copied as-is — the layout must not change.
await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });

console.log(`[tikz-fonts] ${src} → ${dest}`);
