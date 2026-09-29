// copy-embed-bundle —— moves the @standmeet/embed build into public/, so this instance serves it itself.
//
// **Why it must be served**: CLAUDE.md promises the embed is a "single `<script>` tag drop-in", but
// `/embed.js` and `/sdk/embed.js` were both 404 in prod (verified 2026-08-30) —— the package built fine,
// the promise is in the docs, and the step in between just didn't exist. The docs name an address, but
// nothing verified it actually points at something ([[ref-resolves-not-a-string]]).
//
// **What is served**: /embed.js is the loader, a classic script (the drop-in scenario is someone else's
// site writing one `<script src>` line, with no bundler and no import map); it imports the chat itself
// from /embed/ — an ES module build with code splitting, so a host page downloads diagrams and
// pre-baked HTML only when an answer carries one.
//
// **Why serve it ourselves instead of a CDN**: this is a self-hosted product. A CDN means every owner's
// readers make an extra third-party request, and an offline-installed instance can't reach it at all ——
// same reasoning as tikz-fonts.
//
// Runs as part of build, so what gets served always matches the sdk source in this repo.

import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const APP_DIR = join(import.meta.dirname, '..');
const DIST = join(APP_DIR, '..', 'sdk', 'packages', 'embed', 'dist');
const PUBLIC = join(APP_DIR, 'public');

await mkdir(PUBLIC, { recursive: true });
await copyFile(join(DIST, 'loader.global.js'), join(PUBLIC, 'embed.js'));
await rm(join(PUBLIC, 'embed'), { recursive: true, force: true });
await cp(join(DIST, 'esm'), join(PUBLIC, 'embed'), { recursive: true });

console.log(`[embed] ${DIST} → public/embed.js + public/embed/`);
