// copy-embed-bundle —— moves the @standmeet/embed IIFE build into public/, so this instance serves it itself.
//
// **Why it must be served**: CLAUDE.md promises the embed is a "single `<script>` tag drop-in", but
// `/embed.js` and `/sdk/embed.js` were both 404 in prod (verified 2026-08-30) —— the package built fine,
// the promise is in the docs, and the step in between just didn't exist. The docs name an address, but
// nothing verified it actually points at something ([[ref-resolves-not-a-string]]).
//
// **Why the IIFE build**: the drop-in scenario is someone else's site writing one `<script src>` line,
// with no bundler and no import map. The ESM build needs `type="module"` and can't be used on legacy sites.
//
// **Why serve it ourselves instead of a CDN**: this is a self-hosted product. A CDN means every owner's
// readers make an extra third-party request, and an offline-installed instance can't reach it at all ——
// same reasoning as tikz-fonts.
//
// Runs as part of build, so what gets served always matches the sdk source in this repo.

import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const APP_DIR = join(import.meta.dirname, '..');
const src = join(APP_DIR, '..', 'sdk', 'packages', 'embed', 'dist', 'embed.global.js');
const dest = join(APP_DIR, 'public', 'embed.js');

await mkdir(dirname(dest), { recursive: true });
await copyFile(src, dest);

console.log(`[embed] ${src} → ${dest}`);
