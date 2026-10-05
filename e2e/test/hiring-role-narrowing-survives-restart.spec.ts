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

// The invited role (the codes the product issues for the owner) says the same, and sijie.xyz lost
// it on the v0.1.128 upgrade, 2026-10-05: the owner had added subjectivity://background (education
// and work in broad strokes, for invitees), and the restart's re-seed wrote the default back.
const OWN_CHOICE: Record<string, string[]> = { // sorted: the assertions sort what they read
  hiring: ['output://**', 'wiki://**'],
  invited: ['output://**', 'subjectivity://background', 'wiki://**', 'writing://**'],
};

test('the owner\'s corpus allowlists on the builtin roles survive a backend restart', async ({ playwright }) => {
  test.setTimeout(240_000);
  resetInstance();
  const api = await playwright.request.newContext();
  await claim(api, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);

  for (const [name, uris] of Object.entries(OWN_CHOICE)) {
    await setRoleCorpus(api, csrf, await getRoleByName(api, name), uris);
    expect((await getRoleByName(api, name)).corpus_uris.sort(), `${name} set before the restart`)
      .toEqual(uris);
  }

  restartBackend();
  await expect.poll(async () => (await api.get(`${BACKEND}/api/v1/instance`)).status(),
    { timeout: 60_000, message: 'backend back up' }).toBe(200);

  const relog = await loginAPI(api, OWNER.email, OWNER.password);
  expect(relog.csrf, 'signed in again').toBeTruthy();
  for (const [name, uris] of Object.entries(OWN_CHOICE)) {
    expect((await getRoleByName(api, name)).corpus_uris.sort(), `${name}: the owner's list survived`)
      .toEqual(uris);
  }
  await api.dispose();
});
