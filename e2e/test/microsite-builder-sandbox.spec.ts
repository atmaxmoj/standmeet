// microsite-builder-sandbox.spec.ts —— owner code that runs at build time is boxed in (refactor
// ledger R20): it cannot write the builder's filesystem outside its work dir, cannot fork without
// bound, cannot take all the host's memory — and the builder is still alive for the next build.
//
// Where owner code runs: `vite build` only bundles it; the prerender step (builder/runner.mjs)
// IMPORTS it in node to render static HTML. So a page's module-level code is a build-time program
// on the builder. This page probes three limits there and prints what happened into the markup the
// prerender bakes into /p/<slug>, which the spec reads with no browser (the bytes a crawler gets).
//
//   WRITE —— a write to /var/tmp (world-writable in the image) must be refused: the root
//             filesystem is read-only; only the work dir (/tmp) and the shared output volume are
//             writable.
//   SPAWNED —— 400 child processes must not all start: the container's pid limit stops them.
//   HOG —— a child allocating 2.5 GB must be killed (SIGKILL by the OOM killer), not get it.
//
// RED on the old compose (no read_only, no limits): WRITE-WROTE SPAWNED-400 HOG-0.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { publishPage } from '@/fixtures/microsite-rig';

const OWNER = {
  email: 'sandbox@example.com', password: 'correct-horse-battery-staple',
  handle: 'sandboxowner', fullName: 'Sandbox Owner',
};

const BOMB = 400;

// The hog runs before the bomb: once the pid limit is spent, no further child can start at all.
// The sleepers live 5s, so the pid budget is back before the next build needs it.
const PROBE_APP = `
const node = (globalThis as any).process;

function probe(): string {
  if (typeof node?.getBuiltinModule !== 'function') return 'NO-NODE';
  const fs = node.getBuiltinModule('node:fs');
  const cp = node.getBuiltinModule('node:child_process');
  let write = 'WROTE';
  try { fs.writeFileSync('/var/tmp/sm-sandbox-probe', 'x'); } catch { write = 'BLOCKED'; }
  const hog = cp.spawnSync(node.execPath, ['-e', 'Buffer.alloc(2.5e9).fill(1)'], { stdio: 'ignore' });
  let spawned = 0;
  for (let i = 0; i < ${BOMB}; i++) {
    const c = cp.spawn('sleep', ['5'], { stdio: 'ignore' });
    c.on('error', () => {});
    if (c.pid) spawned++;
  }
  return 'WRITE-' + write + ' SPAWNED-' + spawned + ' HOG-' + (hog.signal ?? String(hog.status));
}

const PROBE = probe();

export default function App() {
  return <main><p data-sm="probe">{PROBE}</p></main>;
}
`.trim();

const PLAIN_APP = `
export default function App() {
  return <main><h1>SANDBOX_STILL_BUILDS</h1></main>;
}
`.trim();

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('microsite builder · owner build-time code is boxed in', () => {
  test.describe.configure({ mode: 'serial', timeout: 600_000 });

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('a write outside the work dir, a fork bomb and a memory hog are all stopped', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await publishPage(request, csrf, 'probe', PROBE_APP, 300_000);
    const raw = await (await request.get('/p/probe')).text();
    const m = /WRITE-(\w+) SPAWNED-(\d+) HOG-(\w+)/.exec(raw);
    expect(m, `the prerender printed the probe: ${raw.slice(0, 400)}`).not.toBeNull();
    const [, write, spawned, hog] = m ?? [];
    expect(write, 'the root filesystem refuses the write').toBe('BLOCKED');
    expect(Number(spawned), 'the pid limit stops the bomb').toBeLessThan(BOMB);
    expect(hog, 'the memory limit kills the hog').toBe('SIGKILL');
    await request.dispose();
  });

  test('…and the builder is alive: the next page still builds and goes live', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await publishPage(request, csrf, 'after', PLAIN_APP, 300_000);
    expect(await (await request.get('/p/after')).text()).toContain('SANDBOX_STILL_BUILDS');
    await request.dispose();
  });
});
