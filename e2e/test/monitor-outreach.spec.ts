// monitor-outreach.spec.ts —— the two surfaces that reach people who never open the owner's site.
//
// An embed is the owner's chat widget on somebody else's page. An IM bot is the owner's chat
// inside Telegram or Discord. Both drive the SAME routes as the first-party chat — they use the
// same SDK client — so a route table alone records all three as `chat`, and the owner cannot tell
// their widget's traffic from their own page's. For an outreach surface, that IS the question.
//
// What separates them is on the request rather than in the route: an embed runs in a browser on
// another site and carries a cross-origin `Origin`; the IM bridge is a server and names itself in
// its user agent. This file asserts the separation in both directions — including the control
// case, a first-party request that must NOT be reclassified. Without that control, code that
// called everything an embed would pass every other test here.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { HUMAN_UA, readEvents } from '@/fixtures/monitor';

const OWNER = {
  email: 'monitor-outreach@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'monitoroutreach',
  fullName: 'Monitor Outreach',
};

const BASE = process.env['BASE_URL'] ?? 'http://localhost:38127';
const EMBED_HOST = 'https://news.example.com';
// The user agent the IM bridge sends. A server, not a browser — which is also why the bot filter
// has to be told about it explicitly.
const IM_AGENT = 'standmeet-im-bridge/0.1 (+https://standmeet.dev)';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('monitor outreach · embeds and IM bots are their own surfaces', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('a chat request from another site is recorded as an embed, and names the site', async (
    { request, playwright },
  ) => {
    await chatTurn(playwright, { Origin: EMBED_HOST });

    const rows = await readEvents(request, OWNER, { surface: 'embed' });
    const row = rows[0];
    expect(row, 'a cross-origin chat turn must be recorded on the embed surface').toBeTruthy();
    // "Your widget is being used" is worth much less than "your widget is being used on
    // news.example.com", and the origin is the one thing an owner cannot find out any other way.
    expect(row?.props['origin']).toBe(EMBED_HOST);
    expect(row?.event_name).toBe('chat_turn_sent');
  });

  test('a chat request from the instance itself stays on the chat surface', async (
    { request, playwright },
  ) => {
    const before = await readEvents(request, OWNER, { surface: 'embed', limit: 1000 });
    await chatTurn(playwright, { Origin: BASE });
    const after = await readEvents(request, OWNER, { surface: 'embed', limit: 1000 });

    // The control. Same-origin requests carry the instance's own Origin, and treating that as
    // foreign would turn the entire first-party chat into "embed" — a reclassification that makes
    // every embed number wrong while every test about embeds still passes.
    expect(after.length, 'a same-origin turn is not an embed').toBe(before.length);
    const chat = await readEvents(request, OWNER, { surface: 'chat' });
    expect(chat[0], 'it is recorded as chat').toBeTruthy();
  });

  test('a chat request with no Origin at all stays on the chat surface', async (
    { request, playwright },
  ) => {
    const before = await readEvents(request, OWNER, { surface: 'embed', limit: 1000 });
    await chatTurn(playwright, {});
    const after = await readEvents(request, OWNER, { surface: 'embed', limit: 1000 });

    // Same-origin browser requests often send no Origin header at all. Reading "absent" as
    // "foreign" is the same defect as the previous test, arriving by a different door.
    expect(after.length).toBe(before.length);
  });

  test('the IM bridge is recorded as its own surface', async ({ request, playwright }) => {
    await chatTurn(playwright, {}, IM_AGENT);

    const rows = await readEvents(request, OWNER, { surface: 'im', include_bots: true });
    const row = rows[0];
    expect(row, 'a turn from the IM bridge must be recorded on the im surface').toBeTruthy();
    expect(row?.event_name).toBe('chat_turn_sent');
  });

  test('the IM bridge is not counted as a crawler', async ({ request, playwright }) => {
    await chatTurn(playwright, {}, IM_AGENT);

    const rows = await readEvents(request, OWNER, { surface: 'im', include_bots: true });
    const row = rows[0];
    // A visitor messaging the owner's bot on Telegram is a PERSON. Filing them under bots — which
    // the generic markers would do, since the agent has no browser tokens in it — would drop the
    // whole IM surface out of every human number while the rows still existed, so the surface
    // would look instrumented and count nothing.
    expect(row?.is_bot, 'a person talking through the bridge is not a bot').toBe(false);
  });

  test('an embed on another site is not counted as a crawler either', async (
    { request, playwright },
  ) => {
    await chatTurn(playwright, { Origin: EMBED_HOST });

    const rows = await readEvents(request, OWNER, { surface: 'embed' });
    expect(rows[0]?.is_bot).toBe(false);
  });
});

// chatTurn —— one visitor chat turn, from a context that shares nothing with the owner's session.
//
// The turn is rejected (no session token), and that is fine: the route table records
// `chat_turn_sent` whatever the outcome, because the ratio between sent and answered is the
// signal. What is under test here is which SURFACE the request was filed under, and that is
// decided before the handler runs.
async function chatTurn(
  pw: Playwright, headers: Record<string, string>, userAgent = HUMAN_UA,
): Promise<void> {
  const ctx = await pw.request.newContext({
    baseURL: BASE, extraHTTPHeaders: { 'User-Agent': userAgent, ...headers },
  });
  await ctx.post('/api/v1/agent/turn', { data: { message: 'hello' } });
  await ctx.dispose();
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-outreach-seed');
  await initMCP(request, token);
  await request.dispose();
}
