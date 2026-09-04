// visitor-timezone-to-agent.spec.ts —— #120: the visitor's browser timezone is sent up with every
// /agent/turn, and the backend anchors it into the common instruction so the agent interpreting times
// the visitor gives (especially bookings) is no longer ambiguous and need not ask back "which timezone are you in".
//
// This e2e guards the **pipe**: the browser sets a known timezone (timezoneId), sends one chat turn, and asserts
// the outbound /agent/turn request body actually carries visitor_timezone = that timezone. The agent's **use** of it
// (converting booking times to the visitor's timezone) is LLM behavior, owned by the eval-harness (real DeepSeek), not here.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { goto } from '@/fixtures/navigate';

const TZ = 'Asia/Tokyo';

test.describe('visitor · browser timezone reaches the agent turn (#120)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('the agent/turn request body carries the visitor browser timezone', async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: TZ });
    const page = await ctx.newPage();
    await enterCode(page, seed.code.code, 'Tomoko');

    const turnReq = page.waitForRequest(
      (r) => r.url().endsWith('/api/v1/agent/turn') && r.method() === 'POST',
      { timeout: 20_000 },
    );
    const input = page.getByTestId('chat-input-field');
    await input.fill('what can you tell me about the owner?');
    await input.press('Enter');

    const body = (await turnReq).postDataJSON() as { visitor_timezone?: string };
    expect(body.visitor_timezone).toBe(TZ);
    await ctx.close();
  });
});

// enterCode —— ?code entry → fill name in the name picker → submit → wait for the session to land.
async function enterCode(page: Page, code: string, name: string): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-name-submit').click();
  await session;
}
