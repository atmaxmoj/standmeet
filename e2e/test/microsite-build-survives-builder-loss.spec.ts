// microsite-build-survives-builder-loss.spec.ts —— a page build survives losing its builder.
//
// What happened on prod (2026-09-26, the v0.1.71 upgrade): the updater recreates one service at a
// time, pulling each image first. The backend came up new at 01:27:32; the builder was recreated
// 38s later. In that window the OLD builder kept polling the NEW backend and claimed three builds:
//   - two it finished with the OLD SDK baked in — marked `built`, nothing said anything was wrong;
//   - one it was killed in the middle of — that build stayed `building` forever, and pressing
//     "build" again only handed back the same stuck build.
//
// Two cases, each a builder going away the way it did there:
//   1. A builder of another version polls → it is given nothing, and the current builder builds
//      the page. An old builder sends no version at all (that is what v0.1.69 did).
//   2. A builder claims a build and dies without reporting → the page still gets built.
//
// The test plays the departing builder on /internal/builds/* — the builder's own interface,
// internal-network trust, reachable from here exactly as the builder reaches it (see
// microsite-build-mark-gone.spec.ts). The real builder is stopped while the test claims, so the
// test is the only one polling; it is started again to show the page recovers.

import { execSync } from 'node:child_process';
import type { APIRequestContext } from '@playwright/test';

import { test, expect } from '@/fixtures/test';
import { claim, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { queueBuild } from '@/fixtures/microsite-rig';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'builderloss@example.com', password: 'correct-horse-battery-staple',
  handle: 'builderloss', fullName: 'Builder Loss Owner',
};
const SOURCE = `export default function App() {
  return <main data-testid="survived">This page was built.</main>;
}`;
// RECOVERY —— how long a page may wait after its builder is gone. A dead builder's claim is only
// known dead after its lease runs out, so this is the lease plus one real build on a loaded host.
const RECOVERY = 180_000;

let csrf = '';

test.describe('microsite build · survives losing its builder', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(120_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    await request.dispose();
  });

  // Whatever a case did to the builder, the next spec gets a running one.
  test.afterEach(() => { startBuilder(); });

  test('a builder of another version is given nothing; the current builder builds the page', async (
    { playwright },
  ) => {
    test.setTimeout(RECOVERY + 120_000);
    const request = await ownerRequest(playwright);
    stopBuilder();
    const buildID = await queueBuild(request, csrf, 'skew-page', SOURCE);

    const unversioned = await request.post(`${BACKEND}/internal/builds/claim`);
    expect(unversioned.status(), 'a builder that sends no version (v0.1.69) gets no job').toBe(204);
    // Derived, never typed: dev runs as v0.0.1, so a hand-written "old" version can equal the
    // current one and turn this assertion into a false red once the fix is in.
    const stale = await request.post(`${BACKEND}/internal/builds/claim`, {
      headers: { 'X-Builder-Version': `${await instanceVersion(request)}-previous` },
    });
    expect(stale.status(), 'a builder of another version gets no job').toBe(204);
    expect(await buildStatus(request, buildID), 'the build is still waiting').toBe('pending');

    startBuilder();
    await expectBuilt(request, buildID);
  });

  test('a builder that claims a build and dies: the page still gets built', async ({ playwright }) => {
    test.setTimeout(RECOVERY + 120_000);
    const request = await ownerRequest(playwright);
    stopBuilder();
    const buildID = await queueBuild(request, csrf, 'orphan-page', SOURCE);

    const taken = await request.post(`${BACKEND}/internal/builds/claim`, {
      headers: { 'X-Builder-Version': await instanceVersion(request) },
    });
    expect(taken.status(), 'the dying builder got the job').toBe(200);
    expect((await taken.json() as { build_id: string }).build_id).toBe(buildID);
    // …and never reports back: no PATCH. That builder is gone.

    startBuilder();
    await expectBuilt(request, buildID);
  });
});

async function ownerRequest(
  playwright: { request: { newContext: () => Promise<APIRequestContext> } },
): Promise<APIRequestContext> {
  const request = await playwright.request.newContext();
  ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
  return request;
}

async function buildStatus(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.get(`${BACKEND}/api/admin/microsites/builds/${id}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  return ((await res.json()) as { status?: string }).status ?? '';
}

async function expectBuilt(request: APIRequestContext, id: string): Promise<void> {
  await expect.poll(() => buildStatus(request, id), {
    timeout: RECOVERY, intervals: [2_000],
    message: 'the page never got built after its builder was lost',
  }).toBe('built');
}

async function instanceVersion(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${BACKEND}/api/v1/instance`);
  return ((await res.json()) as { version: string }).version;
}

function stopBuilder(): void {
  execSync('make -C .. dev-stop-svc SVC=builder', { stdio: 'inherit' });
}

function startBuilder(): void {
  execSync('make -C .. dev-restart-svc SVC=builder', { stdio: 'inherit' });
}
