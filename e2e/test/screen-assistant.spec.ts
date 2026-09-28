// screen-assistant.spec.ts —— the desktop cue assistant (a Cheating Daddy fork) listens on the
// owner's computer and streams its cue cards + what it heard up over the owner MCP
// (`assistant.push`). /admin/screen-assistant shows them live, so the owner can read the cards
// on a phone logged into admin while the desktop window is minimized.
//
// Criteria (each can go red):
//   · a pushed cue shows on the page, and the heard line that triggered it shows beside it;
//   · a cue is streamed as growing text under one id — the page shows the LATEST text once,
//     not one card per chunk;
//   · the page offers the desktop app download.

import { test, expect } from '@/fixtures/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'screen-assistant@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'screenassist',
  fullName: 'Screen Assistant Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin screen assistant', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('cues streamed over MCP show live on the page', async ({ request, adminPage }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'screen-assistant');
    const sid = await initMCP(request, token);
    const push = (args: Record<string, unknown>) =>
      callTool(request, token, sid, 'assistant.push', args);

    await gotoAdminSection(adminPage, 'screen-assistant');

    await push({ id: 'h1', kind: 'heard', text: 'How do you isolate untrusted code?' });
    await push({ id: 'c1', kind: 'cue', text: 'Key: isolation' });
    await push({ id: 'c1', kind: 'cue', text: 'Key: isolation + sandbox. Every build runs in its own container.' });

    const cards = adminPage.getByTestId('assistant-cue');
    await expect(cards.first()).toContainText('Every build runs in its own container.', { timeout: 10_000 });
    await expect(cards, 'streamed chunks of one cue are one card').toHaveCount(1);
    await expect(adminPage.getByTestId('assistant-heard').first())
      .toContainText('How do you isolate untrusted code?');
  });

  test('the page offers the desktop app download', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'screen-assistant');
    await expect(adminPage.getByTestId('assistant-download'))
      .toHaveAttribute('href', /github\.com\/.+\/releases/);
  });
});
