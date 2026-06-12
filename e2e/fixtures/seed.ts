// seed.ts —— shared e2e seed boilerplate (#53). Most owner-scoped specs'
// beforeAll is the same shape: reset the instance, then claim a fresh sole
// owner. claimFreshOwner is that combo (reset → claim → dispose the one-shot
// request context), so specs stop hand-rolling an identical `initOwner`.

import type { Playwright } from '@playwright/test';

import { claim, type ClaimOptions } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

export async function claimFreshOwner(
  playwright: Playwright, owner: ClaimOptions = {},
): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), owner);
  await request.dispose();
}
