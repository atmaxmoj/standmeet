// prerender.mjs — build-time static render, run in its own node process by runner.mjs after the
// client build and the SSR build. It renders the owner's App to HTML and injects it into
// dist/index.html's #root, plus a <title> and <meta description> derived from the content — so a
// no-JS AI reader gets the prose. Any throw exits nonzero; the runner then ships the plain SPA, so
// the page still works, it just isn't prerendered.
//
// Text extracted from the render is already HTML-escaped for < > & (renderToString does that for
// text nodes), so it goes straight into <title>; only attribute values need " escaped as well.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const workDir = process.cwd();
const { render } = await import(pathToFileURL(join(workDir, 'dist-server', 'entry-server.mjs')).href);
const appHtml = render();

const indexPath = join(workDir, 'dist', 'index.html');
let html = readFileSync(indexPath, 'utf8');
html = html.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);

const title = firstInner(appHtml, 'h1') || firstInner(appHtml, 'h2');
if (title) html = setTitle(html, title.slice(0, 120));

const desc = firstInner(appHtml, 'p');
if (desc && !/<meta\s+name="description"/i.test(html)) {
  html = html.replace('</title>', `</title><meta name="description" content="${desc.slice(0, 200).replace(/"/g, '&quot;')}">`);
}

writeFileSync(indexPath, html);

// firstInner — the text of the first <tag>…</tag>, with any nested tags stripped. Entities from
// renderToString are left intact (already valid in <title> / meta text).
function firstInner(s, tag) {
  const m = s.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'is'));
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
}

// setTitle — replace the template's placeholder <title>, or add one if somehow absent.
function setTitle(h, t) {
  const tag = `<title>${t}</title>`;
  return /<title>.*?<\/title>/is.test(h)
    ? h.replace(/<title>.*?<\/title>/is, tag)
    : h.replace('</head>', `${tag}</head>`);
}
