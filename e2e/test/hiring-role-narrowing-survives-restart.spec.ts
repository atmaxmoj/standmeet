// hiring-role-narrowing-survives-restart.spec.ts — the owner's narrowing of the hiring role stays.
//
// The hiring role (codes the job loop prints on a résumé QR) says on /admin/roles "Narrow it here
// if applications should show less". Found 2026-09-28: every backend start re-seeded the role and
// wrote its corpus allowlist back to the default (wiki, output, writing, subjectivity://cv). An
// owner who removed the CV entry got it back on the next deploy, and résumé visitors read it again.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance, restartBackend } from '@/fixtures/instance';
import { getRoleByName, setRoleCorpus } from '@/fixtures/roles';

const OWNER = {
  email: 'hiring-narrow@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'hiringnarrow',
  fullName: 'Hiring Narrow Owner',
};
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test('a narrowed hiring role keeps its corpus allowlist across a backend restart', async ({ playwright }) => {
  test.setTimeout(240_000);
  resetInstance();
  const api = await playwright.request.newContext();
  await claim(api, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);

  const narrowed = ['output://**', 'wiki://**']; // sorted: the assertions sort what they read
  await setRoleCorpus(api, csrf, await getRoleByName(api, 'hiring'), narrowed);
  expect((await getRoleByName(api, 'hiring')).corpus_uris.sort(), 'narrowed before the restart')
    .toEqual(narrowed);

  restartBackend();
  await expect.poll(async () => (await api.get(`${BACKEND}/api/v1/instance`)).status(),
    { timeout: 60_000, message: 'backend back up' }).toBe(200);

  const relog = await loginAPI(api, OWNER.email, OWNER.password);
  expect(relog.csrf, 'signed in again').toBeTruthy();
  expect((await getRoleByName(api, 'hiring')).corpus_uris.sort(), 'the narrowing survived the restart')
    .toEqual(narrowed);
  await api.dispose();
});
