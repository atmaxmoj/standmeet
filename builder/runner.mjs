#!/usr/bin/env node
//
// builder runner — long-running service. Polls backend internal endpoint
// for a pending build, sets up a vite project in /tmp/work, runs `vite
// build`, copies dist to the shared volume, PATCHes status. No
// docker.sock; relies on shared named volume with backend.
//
// Per tick (~1s):
//   1. POST /internal/builds/claim (X-Builder-Version) — backend atomically marks one build
//      'building', starts its lease, and returns { build_id, page_id, entry, source_files,
//      lease_ms }. A backend of another version hands out nothing (204).
//   2. Lay out template + owner files into /tmp/work/<build_id>/
//   3. Run `vite build` → dist — renewing the lease (POST /internal/builds/<id>/lease) meanwhile
//   4. cp dist → /srv/microsites/<page_id>/<build_id>/dist
//   5. PATCH /internal/builds/<id> { status: built|failed, ... }
//
// The child processes run async, never execFileSync: a sync child blocks the event loop, and a
// blocked loop sends no lease renewals — a long build would then look like a dead builder.

import { mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const run = promisify(execFile);
const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:8000';
const SHARED_ROOT = process.env.MICROSITES_ROOT || '/srv/microsites';
const TEMPLATE = '/opt/builder/template';
const NODE_MODULES = '/opt/builder/node_modules';
const POLL_INTERVAL_MS = 1000;
// VERSION —— this builder's release, baked into the image as a file (builder/Dockerfile) — never
// read from env, which can outlive the image it came from. The backend gives work only to a
// builder of its own version: an old builder outliving an upgrade gets nothing.
const VERSION = readVersion();

function readVersion() {
  try { return readFileSync('/opt/builder/VERSION', 'utf8').trim() || 'dev'; } catch { return 'dev'; }
}
// PRERENDER_TIMEOUT_MS —— a best-effort step must be bounded: a hung SSR render (owner code that
// keeps the event loop alive) would otherwise hold the single-lane build queue indefinitely. On
// timeout the child is killed and the step throws → logged as "prerender skipped", page still ships.
// Declared up here: the build loop below starts at module top level, before later consts exist.
const PRERENDER_TIMEOUT_MS = 60_000;
// VITE_TIMEOUT_MS —— the client build is not best-effort, but it must be bounded too: a hung vite
// holds the single lane forever. On timeout the build is marked failed with the reason.
const VITE_TIMEOUT_MS = 300_000;

console.log(`[builder] starting; backend=${BACKEND} shared=${SHARED_ROOT}`);

while (true) {
  try {
    const job = await claimJob();
    if (job) {
      await processJob(job);
    } else {
      await delay(POLL_INTERVAL_MS);
    }
  } catch (e) {
    console.error('[builder] tick error:', e?.message || e);
    await delay(POLL_INTERVAL_MS * 3);
  }
}

async function claimJob() {
  const res = await fetch(`${BACKEND}/internal/builds/claim`, {
    method: 'POST', headers: { 'X-Builder-Version': VERSION },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`claim: ${res.status}`);
  return res.json();
}

async function processJob(job) {
  const { build_id, page_id, source_files, entry, lease_ms } = job;
  console.log(`[builder] build ${build_id} (page ${page_id})`);
  const workDir = `/tmp/work/${build_id}`;
  // ms —— per-step wall time, logged with the outcome: a build that took 3 minutes instead of 25s
  // used to leave only "start" and "OK" behind, so which step ate the time was unknowable.
  const ms = {};
  const timed = async (step, fn) => {
    const t = Date.now();
    try { return await fn(); } finally { ms[step] = Date.now() - t; }
  };
  // Renew at a quarter of the lease the backend set: three renewals can be lost before the build
  // is taken for dead.
  const renewal = setInterval(() => { void renewLease(build_id); }, lease_ms / 4);
  try {
    await timed('setup', () => setupViteProject(workDir, source_files, entry));
    await timed('vite', () => runViteBuild(workDir));
    await timed('prerender', () => prerender(workDir));
    const outDir = `${SHARED_ROOT}/${page_id}/${build_id}/dist`;
    mkdirSync(dirname(outDir), { recursive: true });
    cpSync(join(workDir, 'dist'), outDir, { recursive: true });
    await markBuilt(build_id, `${page_id}/${build_id}/dist`);
    console.log(`[builder] build ${build_id} OK ${JSON.stringify(ms)}`);
  } catch (e) {
    const msg = e?.message || String(e);
    console.error(`[builder] build ${build_id} failed ${JSON.stringify(ms)}:`, msg);
    await markFailed(build_id, msg.slice(0, 2000));
  } finally {
    clearInterval(renewal);
    rmSync(workDir, { recursive: true, force: true });
  }
}

// renewLease —— tell the backend this build is still being worked on. Best-effort: a missed
// renewal only matters if the lease runs out, and then the build is rebuilt, not lost.
async function renewLease(buildID) {
  try {
    const res = await fetch(`${BACKEND}/internal/builds/${buildID}/lease`, { method: 'POST' });
    if (!res.ok) console.warn(`[builder] build ${buildID} lease renewal: ${res.status}`);
  } catch (e) {
    console.warn(`[builder] build ${buildID} lease renewal failed:`, e?.message || e);
  }
}

function setupViteProject(workDir, files, entry) {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  cpSync(TEMPLATE, workDir, { recursive: true });
  cpSync(NODE_MODULES, join(workDir, 'node_modules'), { recursive: true, dereference: false });

  const ownerDir = join(workDir, 'src', 'owner');
  mkdirSync(ownerDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    if (relPath.includes('..')) throw new Error(`bad path: ${relPath}`);
    const target = join(ownerDir, relPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  const entryFile = entry || 'App.tsx';
  if (!existsSync(join(ownerDir, entryFile))) {
    throw new Error(`entry file ${entryFile} missing from source_files`);
  }
  const entryBase = entryFile.replace(/\.tsx?$/, '');
  writeFileSync(
    join(workDir, 'src', 'owner-entry.tsx'),
    `export { default } from './owner/${entryBase}';\n`,
    'utf8',
  );
}

// runViteBuild — run one build. **The compiler's own words must be captured**: `stdio: 'inherit'`
// dumps vite's diagnostics into the builder container's own log, leaving the owner's side with only
// `Command failed: node /tmp/work/<uuid>/…/vite.js build --logLevel error` —
// long enough, useless, while the line the owner needs to fix is exactly the one it doesn't say (F-P-3).
//
// After capturing it, the **working directory must be stripped** too: `/tmp/work/<uuid>/` is our
// internal address; printing it to the owner just sends them hunting for a file that doesn't exist.
// What's left is a relative path like `src/owner/App.tsx:3:1`.
async function runViteBuild(workDir) {
  try {
    await run(
      'node',
      [join(workDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error'],
      {
        cwd: workDir,
        encoding: 'utf8',
        timeout: VITE_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: 'production' },
      },
    );
  } catch (e) {
    if (e?.killed) throw new Error(`the build took longer than ${VITE_TIMEOUT_MS / 60_000} minutes and was stopped`);
    throw new Error(viteFailureText(e, workDir));
  }
}

// prerender — render the owner's App to static HTML at build time and inject it into
// dist/index.html, so a no-JS reader (crawler / AI / link-preview bot) gets the prose in the
// initial bytes instead of an empty `<div id="root">`. Two steps: an SSR build of
// src/entry-server.tsx (emits dist-server/entry-server.js) and prerender.mjs, which renders it and
// rewrites dist/index.html.
//
// **Best-effort, never fails the build.** Owner code that touches browser globals at module load,
// or any SSR-build hiccup, throws here — we log and leave the plain client build in place. The page
// still works from the bundle; it's only missing the prerendered copy. Runs in its own node
// process so a crash can't take down this long-running daemon and its memory is freed on exit.
async function prerender(workDir) {
  const vite = join(workDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const opts = {
    cwd: workDir, encoding: 'utf8', timeout: PRERENDER_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
  };
  try {
    await run(
      'node',
      [vite, 'build', '--ssr', 'src/entry-server.tsx', '--outDir', 'dist-server', '--logLevel', 'error'],
      { ...opts, env: { ...process.env, NODE_ENV: 'production' } },
    );
    await run('node', ['prerender.mjs'], opts);
  } catch (e) {
    const said = `${e?.stderr ?? ''}${e?.stdout ?? ''}`.trim() || e?.message || String(e);
    console.warn(`[builder] prerender skipped (page still served, not prerendered): ${said.slice(0, 300)}`);
  }
}

function viteFailureText(e, workDir) {
  const said = `${e?.stderr ?? ''}${e?.stdout ?? ''}`.trim();
  // Fall back to execFile's own message only when the compiler said nothing at all (e.g. the
  // process got killed) — say what we actually know, don't invent a more specific reason.
  const text = said === '' ? (e?.message ?? String(e)) : said;
  return stripWorkDir(dropStackFrames(text), workDir);
}

// dropStackFrames — cuts off esbuild's own call stack.
//
// After capturing stderr, the owner gets "which line broke" **plus** a whole trailing
// `at failureErrorWithLog (node_modules/esbuild/lib/main.js:1748:15) at …`.
// That trail is our dependency's internal path inside our container: useless to the owner,
// and it pushes the two genuinely useful lines out of view. Product rule: no raw stack traces in the UI.
function dropStackFrames(text) {
  const kept = [];
  for (const line of text.split('\n')) {
    if (/^\s*at\s/.test(line)) break;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

// stripWorkDir — `/tmp/work/<uuid>/` is our internal address; printing it to the owner just sends
// them hunting for a file that doesn't exist. What's left after stripping is a relative path like
// `src/owner/App.tsx:3:0`.
function stripWorkDir(text, workDir) {
  return text.split(`${workDir}/`).join('').split(workDir).join('');
}

async function markBuilt(buildID, outputPath) {
  const res = await fetch(`${BACKEND}/internal/builds/${buildID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'built', output_path: outputPath }),
  });
  // 404 = the build's row is gone (superseded / deleted / reset truncated it while vite ran). The
  // work is moot, not failed — log and move on. Throwing here is what produced the noisy
  // `mark built: 500` behind flake #972; a real fault (any other non-ok) still throws.
  if (res.status === 404) {
    console.log(`[builder] build ${buildID} gone (superseded); discarding output`);
    return;
  }
  if (!res.ok) throw new Error(`mark built: ${res.status}`);
}

async function markFailed(buildID, message) {
  await fetch(`${BACKEND}/internal/builds/${buildID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'failed', error_message: message }),
  });
}
