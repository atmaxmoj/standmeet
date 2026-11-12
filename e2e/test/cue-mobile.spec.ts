// cue-mobile.spec.ts —— /cue is the full-screen phone view of the desktop cue app's live cards:
// capture stays on the computer (it pushes over MCP, `assistant.push`), /cue polls the same owner
// feed and renders it with no admin chrome, screen kept awake, installable as a PWA. The owner opens
// it on a phone signed into admin.
//
// Criteria (each can go red):
//   · a cue pushed over MCP shows on /cue, and the heard line that triggered it shows too;
//   · the PWA manifest is served and opens straight to /cue (add-to-home-screen lands on the cards).

import { test, expect } from '@/fixtures/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';
import { callTool, initMCP } from '@/fixtures/mcp';
import { openCue, reloadAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'cue-mobile@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'cuemobile',
  fullName: 'Cue Mobile Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('/cue phone view', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('a cue pushed over MCP shows on /cue', async ({ request, adminPage }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'cue-mobile');
    const sid = await initMCP(request, token);
    const push = (args: Record<string, unknown>) =>
      callTool(request, token, sid, 'assistant.push', args);

    await openCue(adminPage);

    await push({ id: 'h1', kind: 'heard', text: 'How do you isolate untrusted code?' });
    await push({ id: 'c1', kind: 'cue', text: 'Key: isolation' });
    await push({ id: 'c1', kind: 'cue', text: 'Key: isolation + sandbox. Every build runs in its own container.' });

    const cards = adminPage.getByTestId('assistant-cue');
    await expect(cards.first()).toContainText('Every build runs in its own container.', { timeout: 10_000 });
    await expect(cards, 'streamed chunks of one cue are one card').toHaveCount(1);
    await expect(adminPage.getByTestId('assistant-heard').first())
      .toContainText('How do you isolate untrusted code?');
    // The header resolves its i18n label (regression guard: a wrong namespace path renders the raw
    // key "adminNav…" uppercased instead of the words).
    await expect(adminPage.getByTestId('cue-header')).toHaveText(/screen assistant/i);
  });

  // The handoff: while /cue is on screen it heartbeats, and the desktop app's feed read
  // (assistant.read) reports phone_present — that is the signal the desktop uses to hide its own
  // cards. Leaving /cue stops the heartbeat and presence lapses, so the desktop takes the display back.
  test('opening /cue tells the desktop the phone is present; leaving hands it back', async ({ request, adminPage }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'cue-presence');
    const sid = await initMCP(request, token);
    const present = async () =>
      (await callTool<{ phone_present: boolean }>(request, token, sid, 'assistant.read', {})).phone_present;

    await openCue(adminPage);
    await expect.poll(present, { timeout: 8_000 }).toBe(true);

    // Leave /cue (a desktop admin page does NOT heartbeat) → presence lapses within the server's TTL.
    await reloadAdminSection(adminPage, 'screen-assistant');
    await expect.poll(present, { timeout: 12_000 }).toBe(false);
  });

  test('the PWA manifest opens straight to /cue', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBeTruthy();
    const manifest = await res.json() as { start_url?: string; display?: string };
    expect(manifest.start_url).toBe('/cue');
    expect(manifest.display).toBe('standalone');
  });
});
