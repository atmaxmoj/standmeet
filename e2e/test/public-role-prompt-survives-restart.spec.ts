// public-role-prompt-survives-restart.spec.ts — the owner's prompt choice for the public role stays.
//
// The public role answers visitors without a code. Found 2026-10-01: the owner pointed it at their
// own prompt (send résumé requests to the access-code form), and every backend start re-seeded the
// role with the builtin prompt again. The builtin prompt's own text may refresh on boot; which
// prompt the role uses is the owner's choice.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance, restartBackend } from '@/fixtures/instance';
import { createPrompt } from '@/fixtures/prompts';
import { getRoleByName, setRolePrompt } from '@/fixtures/roles';

const OWNER = {
  email: 'public-prompt@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'publicprompt',
  fullName: 'Public Prompt Owner',
};
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test('the public role keeps the prompt the owner chose across a backend restart', async ({ playwright }) => {
  test.setTimeout(240_000);
  resetInstance();
  const api = await playwright.request.newContext();
  await claim(api, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);

  const mine = await createPrompt(api, csrf, {
    name: 'public-resume-to-code', body: 'Send résumé requests to the access-code form.',
  });
  await setRolePrompt(api, csrf, await getRoleByName(api, 'public'), mine.id);
  expect((await getRoleByName(api, 'public')).prompt_id, 'chosen before the restart').toBe(mine.id);

  restartBackend();
  await expect.poll(async () => (await api.get(`${BACKEND}/api/v1/instance`)).status(),
    { timeout: 60_000, message: 'backend back up' }).toBe(200);

  const relog = await loginAPI(api, OWNER.email, OWNER.password);
  expect(relog.csrf, 'signed in again').toBeTruthy();
  expect((await getRoleByName(api, 'public')).prompt_id, 'the choice survived the restart').toBe(mine.id);
  await api.dispose();
});
