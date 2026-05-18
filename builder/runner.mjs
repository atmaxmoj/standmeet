#!/usr/bin/env node
//
// builder runner — long-running service. Polls backend internal endpoint
// for a pending build, sets up a vite project in /tmp/work, runs `vite
// build`, copies dist to the shared volume, PATCHes status. No
// docker.sock; relies on shared named volume with backend.
//
// Per tick (~1s):
//   1. POST /internal/builds/claim — backend atomically marks one
//      pending build as 'building' and returns { build_id, page_id,
//      entry, source_files }
//   2. Lay out template + owner files into /tmp/work/<build_id>/
//   3. Run `vite build` → dist
//   4. cp dist → /srv/custom-pages/<page_id>/<build_id>/dist
//   5. PATCH /internal/builds/<id> { status: built|failed, ... }

import { mkdirSync, writeFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const BACKEND = process.env.BACKEND_INTERNAL_URL || 'http://backend:8000';
const SHARED_ROOT = process.env.CUSTOM_PAGES_ROOT || '/srv/custom-pages';
const TEMPLATE = '/opt/builder/template';
const NODE_MODULES = '/opt/builder/node_modules';
const POLL_INTERVAL_MS = 1000;

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
  const res = await fetch(`${BACKEND}/internal/builds/claim`, { method: 'POST' });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`claim: ${res.status}`);
  return res.json();
}

async function processJob(job) {
  const { build_id, page_id, source_files, entry } = job;
  console.log(`[builder] build ${build_id} (page ${page_id})`);
  const workDir = `/tmp/work/${build_id}`;
  try {
    setupViteProject(workDir, source_files, entry);
    runViteBuild(workDir);
    const outDir = `${SHARED_ROOT}/${page_id}/${build_id}/dist`;
    mkdirSync(dirname(outDir), { recursive: true });
    cpSync(join(workDir, 'dist'), outDir, { recursive: true });
    await markBuilt(build_id, `${page_id}/${build_id}/dist`);
    console.log(`[builder] build ${build_id} OK`);
  } catch (e) {
    const msg = e?.message || String(e);
    console.error(`[builder] build ${build_id} failed:`, msg);
    await markFailed(build_id, msg.slice(0, 2000));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
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

function runViteBuild(workDir) {
  execFileSync(
    'node',
    [join(workDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error'],
    {
      cwd: workDir,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, NODE_ENV: 'production' },
    },
  );
}

async function markBuilt(buildID, outputPath) {
  const res = await fetch(`${BACKEND}/internal/builds/${buildID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'built', output_path: outputPath }),
  });
  if (!res.ok) throw new Error(`mark built: ${res.status}`);
}

async function markFailed(buildID, message) {
  await fetch(`${BACKEND}/internal/builds/${buildID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'failed', error_message: message }),
  });
}
