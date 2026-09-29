// agent-inherits-app-chat.spec.ts —— the SDK is how chat is inherited (docs/design/sdk-chat-inheritance.md).
//
// One chat implementation, three surfaces: the app room, a microsite's <AgentWidget>, and the
// <standmeet-chat> embed. The app room already renders answers as markup (KaTeX, bold), shows the
// retrieval card and the citations, and offers the code's ghost question. This spec asks the same
// things on the other two surfaces and expects the same testids — the app's own.
//
// Also here:
//   · a microsite link carrying ?code= (what a recruiter clicks) must redeem the code and land on
//     the page, not drop the code on /gate;
//   · layout="rail" keeps the agent in view while the visitor reads: on a wide screen the input is
//     on the right and on screen at the top of the page; on a phone it is the floating dock.
//
// RED before the change: the microsite widget renders plain text (no .katex, no citations, no
// ghost), ignores `layout`, and /p/<slug>?code= redirects to a bare /gate. The embed renders its
// own DOM without citations.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, openGate, openReader } from '@/fixtures/navigate';
import { scriptMockReplyText, scriptMockToolCall } from '@/fixtures/mock-llm-script';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'inherit@example.com', password: 'correct-horse-battery-staple',
  handle: 'inherit', fullName: 'Inherit Owner',
};
const CODE = 'INHERIT-1';
const SLUG = 'letter';
const GHOST = 'What did your tests actually catch?';
const TARGET_PATH = 'projects/lucerna';
const TARGET_BODY = 'lucerna is a local-first knowledge tool I built.';
const EMBED_DIST = join(__dirname, '..', '..', 'sdk', 'packages', 'embed', 'dist', 'embed.global.js');

// PAGE —— a long letter with the agent in a rail: the recruiter page's shape. Long enough that
// an agent placed after the letter is far below the first screen.
const PAGE = `
import React from 'react';
import { AgentWidget } from '@standmeet/sdk';
const PARAS = Array.from({ length: 14 }, (_, i) =>
  'Paragraph ' + (i + 1) + ' of the letter. I build the whole thing, and I test it for real. '.repeat(4));
export default function App() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 32 }}>
      <h1>A letter</h1>
      {PARAS.map((p, i) => <p key={i}>{p}</p>)}
      <AgentWidget layout="rail" />
    </main>
  );
}
`.trim();

interface ApiResult { status: number; body: Record<string, unknown> }

async function adminJSON(
  request: APIRequestContext, csrf: string, method: 'get' | 'post' | 'put' | 'patch',
  path: string, data?: unknown,
): Promise<ApiResult> {
  const res = await request[method](`${BACKEND}/api/admin${path}`, {
    headers: { 'X-Csrftoken': csrf }, ...(data === undefined ? {} : { data }),
  });
  return { status: res.status(), body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

async function publishPage(request: APIRequestContext, csrf: string): Promise<void> {
  await adminJSON(request, csrf, 'post', '/microsites/', { slug: SLUG, title: SLUG });
  await adminJSON(request, csrf, 'put', `/microsites/${SLUG}/files`, { path: 'App.tsx', content: PAGE });
  const started = await adminJSON(request, csrf, 'post', `/microsites/${SLUG}/build`);
  expect(started.status, 'start build').toBe(200);
  const id = started.body['build_id'] as string;
  let row: Record<string, unknown> = {};
  await expect.poll(async () => {
    row = (await adminJSON(request, csrf, 'get', `/microsites/builds/${id}`)).body;
    return (row['status'] as string | undefined) ?? 'pending';
  }, { timeout: 300_000, intervals: [2000] }).toMatch(/^(built|failed)$/);
  const why = row['error_message'];
  expect(row['status'], typeof why === 'string' ? why : '').toBe('built');
  expect((await adminJSON(request, csrf, 'post', `/microsites/${SLUG}/live`, { build_id: id })).status,
    'promote to live').toBe(200);
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'inherit-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, { title: 'Lucerna', body: TARGET_BODY, path: TARGET_PATH });
  const code = await createCode(request, csrf, { code: CODE, label: 'inherit', ghosts: [GHOST] });
  await publishPage(request, csrf);
  const bound = await adminJSON(request, csrf, 'patch', `/codes/${code.id}/microsite`, { slug: SLUG });
  expect(bound.status, 'bind the code to the page').toBe(200);
  await request.dispose();
}

// enterOnPage —— the recruiter's path: redeem the code (it lands on its page), then wait for the
// page's agent to hold the code (inline, not the gate hand-off). Attached, not visible: on a phone
// the agent is the floating dock, whose own box is empty (the pill and the panel are fixed).
async function enterOnPage(page: Page, name: string): Promise<void> {
  await enterCodeSession(page, CODE, name);
  await page.waitForURL(`**/p/${SLUG}**`, { timeout: 20_000 });
  await expect(page.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });
}

async function ask(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('agent-widget').getByTestId('chat-input-field');
  await input.fill(text);
  await input.press('Enter');
}

test.describe.configure({ timeout: 420_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(420_000);
  await initOwner(playwright);
});

test.describe('chat is inherited: the microsite renders what the app renders', () => {
  test('a microsite link with ?code= redeems the code and opens the page', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await openReader(page, `/p/${SLUG}/?code=${CODE}`);
    // The code is asked for a name, like every other code link, then the visitor is on the page.
    await page.getByTestId('visitor-name-input').fill('Recruiter Link');
    await page.getByTestId('visitor-name-submit').click();
    await page.waitForURL(`**/p/${SLUG}**`, { timeout: 20_000 });
    await expect(page.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get('code'), 'the plain code leaves the address bar').toBeNull();
    await ctx.close();
  });

  test('microsite answers carry the retrieval card, citations and math, like the app', async ({ page }) => {
    await enterOnPage(page, 'Parity Reader');
    const w = page.getByTestId('agent-widget');

    // The code's ghost question is offered in the composer.
    await expect(w.getByTestId('chat-ghost-text')).toContainText(GHOST, { timeout: 15_000 });

    const readTag = await scriptMockToolCall(page.request, { name: 'corpus_read', args: { path: TARGET_PATH } });
    await ask(page, `tell me about lucerna${readTag}`);
    await expect(w.getByTestId('tool-call-cards').first()).toBeVisible({ timeout: 30_000 });
    const citations = w.getByTestId('citations').first();
    await expect(citations).toBeVisible({ timeout: 30_000 });
    await citations.locator('summary').first().click();
    await expect(w.locator(`[data-testid="citation-row"][data-citation-path="${TARGET_PATH}"]`))
      .toHaveAttribute('href', `/wiki/${TARGET_PATH}`);

    const mathTag = await scriptMockReplyText(page.request, 'Growth is $x^2$ and **really** steady.');
    await ask(page, `how does it grow${mathTag}`);
    const answer = w.getByTestId('answer-body').last();
    await expect(answer.locator('.katex').first(), 'math renders with KaTeX').toBeVisible({ timeout: 30_000 });
    await expect(answer.locator('strong').filter({ hasText: 'really' })).toBeVisible();
  });

  test('layout="rail" keeps the input on screen beside the letter on a wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterOnPage(page, 'Rail Reader');
    await page.evaluate(() => window.scrollTo(0, 0));
    const input = page.getByTestId('agent-widget').getByTestId('chat-input-field');
    await expect(input).toBeVisible({ timeout: 15_000 });
    const box = await input.boundingBox();
    expect(box, 'the input has a box').not.toBeNull();
    // On the first screen, without scrolling — and on the right, beside the letter.
    expect(box!.y + box!.height, 'input is on the first screen').toBeLessThanOrEqual(900);
    expect(box!.x, 'input is in the right-hand rail').toBeGreaterThan(1440 / 2);
    // Still on screen after reading halfway down.
    await page.mouse.wheel(0, 1600);
    await expect.poll(async () => {
      const b = await input.boundingBox();
      return b !== null && b.y >= 0 && b.y + b.height <= 900;
    }, { timeout: 5_000 }).toBe(true);
  });

  test('layout="rail" on a phone is the floating dock', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterOnPage(page, 'Phone Reader');
    await page.evaluate(() => window.scrollTo(0, 0));
    const pill = page.getByTestId('floating-dock-pill');
    await expect(pill).toBeInViewport({ timeout: 15_000 });
    await pill.click();
    await expect(page.getByTestId('floating-chat-panel').getByTestId('chat-input-field')).toBeVisible();
  });
});

test.describe('chat is inherited: the embed renders what the app renders', () => {
  test('the <standmeet-chat> embed renders citations and math too', async ({ page }) => {
    await openGate(page, '/gate');
    await page.addScriptTag({ content: readFileSync(EMBED_DIST, 'utf8') });
    const base = process.env['BASE_URL'] ?? 'http://localhost:38127';
    await page.evaluate(([b, c]) => {
      const el = document.createElement('standmeet-chat');
      el.setAttribute('base-url', b ?? '');
      el.setAttribute('mode', 'code');
      el.setAttribute('code', c ?? '');
      document.body.append(el);
    }, [base, CODE]);
    const embed = page.locator('standmeet-chat');
    const input = embed.getByTestId('chat-input-field');
    await expect(input).toBeVisible({ timeout: 15_000 });

    const readTag = await scriptMockToolCall(page.request, { name: 'corpus_read', args: { path: TARGET_PATH } });
    await input.fill(`tell me about lucerna${readTag}`);
    await input.press('Enter');
    await expect(embed.getByTestId('citations').first()).toBeVisible({ timeout: 30_000 });

    const mathTag = await scriptMockReplyText(page.request, 'Growth is $x^2$.');
    await input.fill(`how does it grow${mathTag}`);
    await input.press('Enter');
    await expect(embed.getByTestId('answer-body').last().locator('.katex').first())
      .toBeVisible({ timeout: 30_000 });
  });
});
