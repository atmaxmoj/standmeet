/**
 * SSG Build Script for StandMeet Pages
 *
 * 1. Reads source files from /workspace/source/
 * 2. Reads content data from /workspace/data/content.json
 * 3. Reads asset manifest from /workspace/data/assets.json
 * 4. Reads page meta from /workspace/data/meta.json
 * 5. Reads page config from /workspace/data/config.json
 * 6. Builds with Vite → client bundle + SSR module
 * 7. Renders to string (SSG) with data injected
 * 8. Injects meta tags into HTML head
 * 9. Outputs to /workspace/dist/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const WORKSPACE = process.env.WORKSPACE || '/workspace';
const SOURCE_DIR = join(WORKSPACE, 'source');
const DATA_DIR = join(WORKSPACE, 'data');
const DIST_DIR = join(WORKSPACE, 'dist');

function log(msg) {
  console.log(`[build] ${msg}`);
}

function readJSON(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function buildMetaTags(meta, config) {
  const tags = [];

  if (meta.title) {
    tags.push(`<title>${escapeHtml(meta.title)}</title>`);
    tags.push(`<meta property="og:title" content="${escapeAttr(meta.title)}" />`);
    tags.push(`<meta name="twitter:title" content="${escapeAttr(meta.title)}" />`);
  }

  if (meta.description) {
    tags.push(`<meta name="description" content="${escapeAttr(meta.description)}" />`);
    tags.push(`<meta property="og:description" content="${escapeAttr(meta.description)}" />`);
    tags.push(`<meta name="twitter:description" content="${escapeAttr(meta.description)}" />`);
  }

  if (meta.favicon_url) {
    tags.push(`<link rel="icon" href="${escapeAttr(meta.favicon_url)}" />`);
  }

  if (meta.og_image_url) {
    tags.push(`<meta property="og:image" content="${escapeAttr(meta.og_image_url)}" />`);
    tags.push(`<meta name="twitter:image" content="${escapeAttr(meta.og_image_url)}" />`);
    tags.push(`<meta name="twitter:card" content="summary_large_image" />`);
  } else {
    tags.push(`<meta name="twitter:card" content="summary" />`);
  }

  tags.push(`<meta property="og:type" content="website" />`);

  if (meta.custom_head) {
    tags.push(meta.custom_head);
  }

  return tags.join('\n    ');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  log('Starting build...');

  // Copy workspace source files into /app/source so Vite can resolve them
  // (Vite project root is /app; entry must be inside root)
  const appSource = join('/app', 'source');
  if (existsSync(appSource)) {
    execSync('rm -rf /app/source');
  }
  cpSync(SOURCE_DIR, appSource, { recursive: true });
  log(`Copied ${SOURCE_DIR} → /app/source`);

  // Read data
  const contentData = readJSON(join(DATA_DIR, 'content.json'));
  const assetManifest = readJSON(join(DATA_DIR, 'assets.json'));
  const meta = readJSON(join(DATA_DIR, 'meta.json'));
  const config = readJSON(join(DATA_DIR, 'config.json'));

  log(`Content entries: ${Array.isArray(contentData) ? contentData.length : 0}`);
  log(`Assets: ${Object.keys(assetManifest).length}`);

  // All generated source files go to /app/source/ (Vite project root)
  const appSourceDir = '/app/source';

  // Create source/index.html if not present
  const indexHtmlPath = join(appSourceDir, 'index.html');
  if (!existsSync(indexHtmlPath)) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!--HEAD_TAGS-->
</head>
<body>
    <div id="root"><!--SSR--></div>
    <script type="module" src="./entry-client.tsx"></script>
</body>
</html>`;
    writeFileSync(indexHtmlPath, html);
  }

  // Create entry-client.tsx for hydration
  const entryClientPath = join(appSourceDir, 'entry-client.tsx');
  if (!existsSync(entryClientPath)) {
    const entryClient = `import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import App from './App';

// Inject data for client-side components
(window as any).__STANDMEET_DATA__ = (window as any).__STANDMEET_DATA__ || ${JSON.stringify({ content: contentData, assets: assetManifest })};
(window as any).__STANDMEET_CONFIG__ = (window as any).__STANDMEET_CONFIG__ || ${JSON.stringify(config)};

hydrateRoot(document.getElementById('root')!, <App />);
`;
    writeFileSync(entryClientPath, entryClient);
  }

  // Create entry-server.tsx for SSR
  const entryServerPath = join(appSourceDir, 'entry-server.tsx');
  const entryServer = `import React from 'react';
import { renderToString } from 'react-dom/server';
import App from './App';

// Inject data globally for SSR
(globalThis as any).__STANDMEET_DATA__ = ${JSON.stringify({ content: contentData, assets: assetManifest })};
(globalThis as any).__STANDMEET_CONFIG__ = ${JSON.stringify(config)};

export function render() {
  return renderToString(<App />);
}
`;
  writeFileSync(entryServerPath, entryServer);

  // Build client bundle
  log('Building client bundle...');
  const viteBase = config.page_id ? `/api/pages/${config.page_id}/` : '/';
  log(`Using base: ${viteBase}`);
  execSync(`npx vite build --outDir ${DIST_DIR} --base ${viteBase}`, {
    cwd: '/app',
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  // Build SSR module (output inside /app so Node.js can find node_modules)
  log('Building SSR module...');
  execSync('npx vite build --outDir /app/dist-ssr --ssr source/entry-server.tsx', {
    cwd: '/app',
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  // Render SSR
  log('Rendering SSG HTML...');
  const ssrModule = await import('/app/dist-ssr/entry-server.js');
  const appHtml = ssrModule.render();

  // Read the built index.html
  let html = readFileSync(join(DIST_DIR, 'source/index.html'), 'utf-8');

  // Replace SSR placeholder
  html = html.replace('<!--SSR-->', appHtml);

  // Inject meta tags
  const metaTags = buildMetaTags(meta, config);
  html = html.replace('<!--HEAD_TAGS-->', metaTags);

  // Inject data script for client hydration
  const dataScript = `<script>
window.__STANDMEET_DATA__=${JSON.stringify({ content: contentData, assets: assetManifest })};
window.__STANDMEET_CONFIG__=${JSON.stringify(config)};
</script>`;
  html = html.replace('</head>', `${dataScript}\n</head>`);

  // Write final HTML
  writeFileSync(join(DIST_DIR, 'index.html'), html);

  log('Build complete!');
}

main().catch(err => {
  console.error('[build] FATAL:', err);
  process.exit(1);
});
