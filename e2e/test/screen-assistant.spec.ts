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

import { test, expect, type APIRequestContext, type Page } from '@/fixtures/test';

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

interface ReadEvent { id: string; kind: string; text: string; seq: number }

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

  // A card on a question that names a technology carries a choice matrix (a GFM table) for the
  // deep dive — "why bubblewrap, not Docker". It must render as a table, not as pipe characters.
  test('a card with a choice matrix shows it as a table', async ({ request, adminPage }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'screen-assistant-matrix');
    const sid = await initMCP(request, token);
    await gotoAdminSection(adminPage, 'screen-assistant');
    await callTool(request, token, sid, 'assistant.push', {
      id: 'matrix-1', kind: 'cue',
      text: [
        '**Key: isolation + no docker.sock**',
        '**The backend never holds docker.sock, so plugins run in bubblewrap.**',
        '',
        '**Why this over the alternatives:**',
        '| Option | Picked | Good at | Why (not) here |',
        '|---|---|---|---|',
        '| bubblewrap | ✓ | namespaces without a daemon | needs no docker.sock |',
        '| Docker | | full containers | would hand the backend root on the host |',
      ].join('\n'),
    });
    const table = adminPage.getByTestId('assistant-cue').filter({ hasText: 'Why this over' }).locator('table');
    await expect(table).toBeVisible({ timeout: 10_000 });
    await expect(table.locator('tbody tr').first()).toContainText('bubblewrap');
    await expect(table.locator('tbody tr')).toHaveCount(2);
  });

  test('the owner AI reads the feed back over MCP', readsFeedBack);
  test('a mock-interview agent pushes the question and the answer', mockInterviewPushes);

  test('the page offers the desktop app download', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'screen-assistant');
    await expect(adminPage.getByTestId('assistant-download'))
      .toHaveAttribute('href', /github\.com\/.+\/releases/);
  });
});

// readsFeedBack -- the owner's AI reads the same feed over MCP (assistant.read): after the
// interview it can see what was asked and what the cards said. A streamed cue comes back once,
// with its latest text; `since` = the last_seq of a previous read returns only what came after.
async function readsFeedBack({ request }: { request: APIRequestContext }): Promise<void> {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'screen-assistant-read');
    const sid = await initMCP(request, token);
    const push = (args: Record<string, unknown>) =>
      callTool(request, token, sid, 'assistant.push', args);
    const read = (since: number) => callTool<{ events: ReadEvent[]; last_seq: number }>(
      request, token, sid, 'assistant.read', { since });

    await push({ id: 'rh1', kind: 'heard', text: 'Why Go for the backend?' });
    await push({ id: 'rc1', kind: 'cue', text: 'Key: Go' });
    await push({ id: 'rc1', kind: 'cue', text: 'Key: Go. One static binary per release.' });

    const all = await read(0);
    const heard = all.events.find((e) => e.id === 'rh1');
    expect(heard?.kind).toBe('heard');
    expect(heard?.text).toBe('Why Go for the backend?');
    const cues = all.events.filter((e) => e.id === 'rc1');
    expect(cues, 'a streamed cue reads back once').toHaveLength(1);
    expect(cues[0]?.text).toBe('Key: Go. One static binary per release.');

    await push({ id: 'rh2', kind: 'heard', text: 'And the frontend?' });
    const next = await read(all.last_seq);
    expect(next.events.map((e) => e.id), 'since returns only what came after').toEqual(['rh2']);
}

// mockInterviewPushes -- another agent runs a mock interview (owner, 2026-10-19: "我用别的agent来做
// 模拟面试，我也是需要那个agent把card给我的"). It pushes its question as heard — the desktop assistant
// cues it — and the owner's answer as said. The answer shows on the page as the owner's line, and
// reads back.
async function mockInterviewPushes(
  { request, adminPage }: { request: APIRequestContext; adminPage: Page },
): Promise<void> {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'screen-assistant-mock');
    const sid = await initMCP(request, token);
    await gotoAdminSection(adminPage, 'screen-assistant');
    await callTool(request, token, sid, 'assistant.push',
      { id: 'mq1', kind: 'heard', text: 'Tell me about a time you disagreed with a teammate.' });
    await callTool(request, token, sid, 'assistant.push',
      { id: 'ma1', kind: 'said', text: 'We argued about Docker versus bubblewrap.' });

    await expect(adminPage.getByTestId('assistant-said').first())
      .toContainText('We argued about Docker versus bubblewrap.', { timeout: 10_000 });
    await expect(adminPage.getByTestId('assistant-heard').filter({ hasText: 'disagreed with a teammate' }))
      .toBeVisible();

    const { events } = await callTool<{ events: ReadEvent[] }>(
      request, token, sid, 'assistant.read', { since: 0 });
    expect(events.find((e) => e.id === 'ma1')?.kind).toBe('said');
}
