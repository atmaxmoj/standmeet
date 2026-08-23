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

// runViteBuild —— 跑一次构建。**编译器说的话要抓回来**：`stdio: 'inherit'` 把 vite 的
// 诊断丢进 builder 容器自己的日志，于是 owner 那一侧只剩 execFileSync 自己那句
// `Command failed: node /tmp/work/<uuid>/…/vite.js build --logLevel error` ——
// 长度够、一个字都用不上，而 owner 要改的正是它没说的那一行（F-P-3）。
//
// 抓回来之后还得**去掉工作目录**：`/tmp/work/<uuid>/` 是我们的内部地址，
// 印给 owner 只会让他去找一个不存在的文件。剩下的是 `src/owner/App.tsx:3:1` 这样的相对路径。
function runViteBuild(workDir) {
  try {
    execFileSync(
      'node',
      [join(workDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error'],
      {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'production' },
      },
    );
  } catch (e) {
    throw new Error(viteFailureText(e, workDir));
  }
}

function viteFailureText(e, workDir) {
  const said = `${e?.stderr ?? ''}${e?.stdout ?? ''}`.trim();
  // 编译器一句话没说的时候（比如进程被杀）才退回 execFileSync 那句 —— 说不清就说
  // 我们知道的那点，不编一个更具体的原因。
  const text = said === '' ? (e?.message ?? String(e)) : said;
  return stripWorkDir(dropStackFrames(text), workDir);
}

// dropStackFrames —— 砍掉 esbuild 自己的调用栈。
//
// 抓回 stderr 之后，owner 拿到的是「哪一行坏了」**加上**一整串
// `at failureErrorWithLog (node_modules/esbuild/lib/main.js:1748:15) at …`。
// 那串是我们的依赖在我们的容器里的内部路径：对 owner 一个字都用不上，
// 而它把真正有用的那两行挤到了看不见的地方。产品的规矩是界面上不出现裸栈。
function dropStackFrames(text) {
  const kept = [];
  for (const line of text.split('\n')) {
    if (/^\s*at\s/.test(line)) break;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

// stripWorkDir —— `/tmp/work/<uuid>/` 是我们的内部地址，印给 owner 只会让他
// 去找一个不存在的文件。去掉之后剩下 `src/owner/App.tsx:3:0` 这样的相对路径。
function stripWorkDir(text, workDir) {
  return text.split(`${workDir}/`).join('').split(workDir).join('');
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
