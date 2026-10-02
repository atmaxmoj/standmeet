// notify-rule-live-transcript.spec.ts —— story 3 of docs/design/notify-rules-and-live-transcript.md:
// a recruiter uses the owner's code, the owner gets a Telegram card, taps it, and watches the
// conversation live.
//
// Real stack end to end: the dev stack's im-bridge polls the Telegram Bot API stand-in
// (mock-stack/job-board/telegram.go) exactly as it polls api.telegram.org. The spec plays the
// owner's side of the chat through that stand-in (fixtures/telegram.ts) and drives everything else
// as a person would: the admin page, the visitor's browser, the link on the card.
//
// RED on the code of 2026-10-01: there is no notification rule, no IM channel, no pairing and no
// live transcript page.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser, BrowserContext, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession, gotoAdminSection, openReader } from '@/fixtures/navigate';
import { holdGetStreams } from '@/fixtures/proxy';
import { connectTelegram, ownerTypes, resetTelegram, sentTo, type SentMessage } from '@/fixtures/telegram';

const OWNER = {
  email: 'notify-rules@example.com', password: 'correct-horse-battery-staple',
  handle: 'notifyowner', fullName: 'Notify Owner',
};
const CODE = 'RECRUIT-1';
const BOT_TOKEN = '7000001:NOTIFY-RULES-abcdefghijklmnopqrstuvwxyz0123';
const OWNER_CHAT = 4242;
const FIRST_VISITOR = 'Dana Recruiter';
const SECOND_VISITOR = 'Eve Second';
const FIRST_QUESTION = 'What did you build at FlexMesh?';

interface Visitor { ctx: BrowserContext; page: Page }

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// liveLink —— carried from the card (test 3) to the live page (tests 4 and 6).
let liveLink = '';
// firstVisitor —— the recruiter's browser, kept open from test 3 to test 4: the live page follows
// that one conversation, and a new browser would start another one.
let firstVisitor: Visitor | null = null;

test.describe.serial('notification rules · a code conversation reaches the owner on Telegram, live', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(120_000);
    await initOwner(playwright);
  });

  test('the owner links Telegram by sending the bot the code the admin shows', async ({ adminPage, request }) => {
    test.setTimeout(150_000);
    await linkOwnerChat(adminPage, request);
  });

  test('the owner adds two rules for the code: one first-time only, one every time', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'notify');
    await addRule(adminPage, { template: 'R1 {code} · {visitor}', firstOnly: true });
    await addRule(adminPage, { template: 'R2 {code}', firstOnly: false });
    await expect(adminPage.getByTestId('notify-rule-row'), 'both rules are listed').toHaveCount(2);
  });

  test('a recruiter starts a conversation: one card, naming the code and the visitor, with a link', async ({ browser, request }) => {
    test.setTimeout(120_000);
    await firstCard(browser, request);
  });

  test('the link opens the transcript without signing in, and the next answer streams in', async ({ browser, request }) => {
    test.setTimeout(180_000);
    await watchLive(browser, request);
  });

  test('a second conversation on the same code sends no second first-time card', async ({ browser, request }) => {
    test.setTimeout(120_000);
    const visitor = await openVisitor(browser, SECOND_VISITOR);
    await ask(visitor.page, 'Hello there', await scriptMockReplyText(request, 'SECOND_ANSWER'));
    // R2 fires every time: its second card is the proof the second conversation was handled.
    await expect.poll(async () => cards(request, 'R2'), { timeout: 60_000 }).toHaveLength(2);
    expect(await cards(request, 'R1'), 'the first-time rule stayed quiet').toHaveLength(1);
    await visitor.ctx.close();
  });

  test('a tampered link shows nothing of the conversation', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const path = new URL(liveLink).pathname;
    await openReader(page, path.slice(0, -2) + (path.endsWith('aa') ? 'bb' : 'aa'));
    await expect(page.getByTestId('live-invalid'), 'the page says the link is not valid').toBeVisible();
    await expect(page.getByText(FIRST_QUESTION)).toHaveCount(0);
    await ctx.close();
  });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await resetTelegram(request);
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createCode(request, csrf, { code: CODE, label: 'recruiter' });
  expect(await connectTelegram(request, csrf, BOT_TOKEN), 'telegram connected').toBe(200);
  await request.dispose();
}

async function linkOwnerChat(adminPage: Page, request: APIRequestContext): Promise<void> {
  await gotoAdminSection(adminPage, 'notify');
  await adminPage.getByTestId('notify-im-link').click();
  const code = (await adminPage.getByTestId('notify-im-pairing-code').textContent())?.trim() ?? '';
  expect(code, 'the admin shows a pairing code').toMatch(/^[A-Z0-9]{6,}$/);
  await expect(adminPage.getByTestId('notify-im-instructions'), 'it says what to send')
    .toContainText(`/pair ${code}`);
  // The bridge starts polling once the bot token is connected; keep sending until it answers.
  await expect.poll(async () => {
    if ((await sentTo(request, OWNER_CHAT)).length === 0) await ownerTypes(request, OWNER_CHAT, `/pair ${code}`);
    return (await sentTo(request, OWNER_CHAT)).map((m) => m.text).join('\n');
  }, { timeout: 120_000, intervals: [5_000], message: 'the bot never answered the pairing message' })
    .toMatch(/linked/i);
  await expect(adminPage.getByTestId('notify-im-status').first(), 'the admin sees the link')
    .toHaveText(/linked/i, { timeout: 30_000 });
}

async function firstCard(browser: Browser, request: APIRequestContext): Promise<void> {
  firstVisitor = await openVisitor(browser, FIRST_VISITOR);
  await ask(firstVisitor.page, FIRST_QUESTION, await scriptMockReplyText(request, 'FIRST_ANSWER'));
  await expect(firstVisitor.page.getByTestId('answer-body').last()).toContainText('FIRST_ANSWER', { timeout: 30_000 });
  await expect.poll(async () => cards(request, 'R1'), { timeout: 60_000, message: 'no R1 card' })
    .toHaveLength(1);
  const [card] = await cards(request, 'R1');
  expect(card?.text, 'the card names the code').toContain(CODE);
  expect(card?.text, 'the card names the visitor').toContain(FIRST_VISITOR);
  liveLink = card?.buttons.find((u) => u.includes('/live/')) ?? '';
  expect(liveLink, 'the card carries the live transcript link').not.toBe('');
}

async function watchLive(browser: Browser, request: APIRequestContext): Promise<void> {
  const visitor = firstVisitor;
  if (visitor === null) throw new Error('the first visitor is gone');
  const owner = await browser.newContext();
  const live = await owner.newPage();
  // The owner opens the link through the proxy a real deployment has (sijie.xyz: Cloudflare).
  await holdGetStreams(live);
  await openReader(live, new URL(liveLink).pathname);
  await expect(live.getByTestId('live-transcript'), 'the page opens without a sign-in').toBeVisible();
  await expect(live.getByTestId('live-transcript'), 'with the conversation so far')
    .toContainText(FIRST_QUESTION);
  // The answer starts 35s after the question: the owner's stream must outlive the server's 30s
  // write timeout before its first word arrives.
  const words = 'ALPHA one two three four five six seven eight OMEGA';
  // dripMs 1500: ALPHA→OMEGA takes ~13s, so the "still streaming" look lands inside it even when
  // the expect poll has slowed to 1s steps after the long wait (at 400ms it once missed).
  const reply = await scriptMockReplyText(request, words, { delayMs: 35_000, dripMs: 1_500 });
  await ask(visitor.page, 'And what came next?', reply);
  const growing = live.getByTestId('answer-body').last();
  await expect(growing, 'the answer starts arriving').toContainText('ALPHA', { timeout: 75_000 });
  expect(await growing.textContent(), 'it is still streaming: the last word is not there yet')
    .not.toContain('OMEGA');
  await expect(growing, 'and it finishes').toContainText('OMEGA', { timeout: 30_000 });
  await visitor.ctx.close();
  await owner.close();
}

// addRule —— conversation.started, scoped to CODE, to the linked Telegram chat.
async function addRule(page: Page, r: { template: string; firstOnly: boolean }): Promise<void> {
  await page.getByTestId('notify-rule-new').click();
  await page.getByTestId('notify-rule-event').selectOption('conversation.started');
  await page.getByTestId('notify-rule-code').selectOption({ label: CODE });
  if (r.firstOnly) await page.getByTestId('notify-rule-first-only').check();
  await page.getByTestId('notify-rule-channel').selectOption({ label: 'Telegram' });
  await page.getByTestId('notify-rule-template').fill(r.template);
  await page.getByTestId('notify-rule-save').click();
  await expect(page.getByTestId('notify-rule-row').filter({ hasText: r.template })).toBeVisible();
}

async function openVisitor(browser: Browser, name: string): Promise<Visitor> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterCodeSession(page, CODE, name);
  return { ctx, page };
}

async function ask(page: Page, question: string, tag: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(`${question}${tag}`);
  await input.press('Enter');
}

// cards —— the bot's messages to the owner that came from the rule whose template starts with `mark`.
async function cards(request: APIRequestContext, mark: string): Promise<SentMessage[]> {
  return (await sentTo(request, OWNER_CHAT)).filter((m) => m.text.startsWith(mark));
}
