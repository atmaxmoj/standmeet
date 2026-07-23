// page-corpus-pinning.spec.ts —— 主页 insights/projects = corpus pin 列表
// (docs/design/page-corpus-pinning.md)。
//
// 想法只存一份:栏目存 wiki id 引用,渲染时 join title+excerpt 链去 /wiki/…。
// 不变量 pinned ⊆ published 在两端写入点维护:
//   • page.pin 拒未发布("publish it first")
//   • unpublish 已 pin 条目 → 成功 + 自动 unpin + tool result 里声明
// 空栏目整个不渲染(标题也不渲)。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'pin-owner@example.com', password: 'correct-horse-battery-staple',
  handle: 'pinowner', fullName: 'Pin Owner',
};
const EXCERPT_A = 'How feedback loops quietly shape every product decision.';

let apiToken = '';
let mcpSID = '';
let publishedID = '';
let gatedID = '';

interface PinResult { section: string; pinned: string[] }
interface SetSEOResult { wiki_id: string; published: boolean; unpinned_sections?: string[] }
interface AdminPage { insights: string[]; projects: string[] }

type PW = Parameters<Parameters<typeof test>[1]>[0]['playwright'];

test.describe('page-corpus pinning · insights/projects are windows onto the corpus', () => {
  test.beforeAll(async ({ playwright }) => { await seedFixture(playwright); });

  test('pin a published entry via MCP → homepage renders the card linking into the reader',
    async ({ page, playwright }) => { await pinRendersCard(page, playwright); });

  test('pin an unpublished entry → rejected at write time (publish it first)',
    async ({ playwright }) => { await pinUnpublishedRejected(playwright); });

  test('unpublish a pinned entry → auto-unpins, declares it, homepage drops the card',
    async ({ page, playwright }) => { await unpublishDropsCard(page, playwright); });

  test('empty sections render nothing — headers included',
    async ({ page }) => { await emptySectionsHidden(page); });

  test('admin pin manager: pick a published entry, save, homepage renders it',
    async ({ page, playwright }) => { await adminPinManagerRenders(page, playwright); });

  test('page.unpin removes the card again',
    async ({ page, playwright }) => { await unpinRemovesCard(page, playwright); });
});

async function seedFixture(playwright: PW): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  apiToken = await createAPIToken(request, csrf, 'pin-seed');
  mcpSID = await initMCP(request, apiToken);
  const a = await seedWiki(request, apiToken, mcpSID, {
    title: 'Thinking In Systems', body: 'Feedback loops everywhere.',
    path: 'thinking-in-systems',
  });
  publishedID = a.wikiID;
  await callTool(request, apiToken, mcpSID, 'seo.set_wiki_seo',
    { wiki_id: publishedID, excerpt: EXCERPT_A, published: true });
  const b = await seedWiki(request, apiToken, mcpSID, {
    title: 'Gated Thought', body: 'Not for the public page.', path: 'gated-thought',
  });
  gatedID = b.wikiID;
  await request.dispose();
}

// ── 装填:MCP page.pin(published 条目) → 主页渲染卡(title+excerpt+/wiki 链) ──
async function pinRendersCard(page: Page, playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  const res = await callTool<PinResult>(request, apiToken, mcpSID, 'page.pin',
    { section: 'insights', wiki_id: publishedID });
  expect(res.pinned, 'pin list holds the entry').toContain(publishedID);
  await request.dispose();

  await goto(page, '/');
  await expect(page.getByText("things I've been thinking about")).toBeVisible();
  // 卡 = 条目的 title + excerpt,链去 reader — 不是第二份内容。
  const link = page.getByRole('link', { name: /Thinking In Systems/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/wiki/thinking-in-systems');
  await expect(page.getByText(EXCERPT_A)).toBeVisible();
}

// ── 不变量端点 1:pin 未发布 → 写入点拒绝 ──
async function pinUnpublishedRejected(playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  await expect(async () => {
    await callTool(request, apiToken, mcpSID, 'page.pin',
      { section: 'insights', wiki_id: gatedID });
  }).rejects.toThrow(/publish/i);
  // admin PUT 同 URI 面同样被同一个 maintainer 拒(单一维护点,非双实现)。
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const current = await (await request.get(`${BACKEND}/api/admin/page`)).json() as AdminPage;
  const put = await request.put(`${BACKEND}/api/admin/page`, {
    headers: { 'X-Csrftoken': csrf },
    data: { ...current, insights: [...current.insights, gatedID] },
  });
  expect(put.status(), 'admin PUT with an unpublished pin → 400').toBe(400);
  await request.dispose();
}

// ── 不变量端点 2:unpublish 已 pin 条目 → 成功 + 自动 unpin + 声明 ──
async function unpublishDropsCard(page: Page, playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  const res = await callTool<SetSEOResult>(request, apiToken, mcpSID, 'seo.set_wiki_seo',
    { wiki_id: publishedID, excerpt: EXCERPT_A, published: false });
  expect(res.published).toBe(false);
  expect(res.unpinned_sections, 'the side effect is declared in the tool result')
    .toContain('insights');
  // 存储侧:pin 列表已空。
  await loginAPI(request, OWNER.email, OWNER.password);
  const admin = await (await request.get(`${BACKEND}/api/admin/page`)).json() as AdminPage;
  expect(admin.insights, 'pin removed from the stored page').toEqual([]);
  await request.dispose();

  // 渲染侧:空栏目整个消失(标题也不渲)。
  await goto(page, '/');
  await expect(page.getByText("things I've been thinking about")).toHaveCount(0);
  await expect(page.getByText('Thinking In Systems')).toHaveCount(0);
}

// ── 空态:未 pin 的栏目连标题都不渲染 ──
async function emptySectionsHidden(page: Page): Promise<void> {
  await goto(page, '/');
  await expect(page.getByText("things I've been thinking about")).toHaveCount(0);
  await expect(page.getByText("what I'm building")).toHaveCount(0);
}

// ── admin GUI:pin manager 从 published 条目里挑,保存后主页渲染 ──
async function adminPinManagerRenders(page: Page, playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  await callTool(request, apiToken, mcpSID, 'seo.set_wiki_seo',
    { wiki_id: publishedID, excerpt: EXCERPT_A, published: true });
  await request.dispose();

  await loginViaGUI(page);
  await goto(page, '/admin/page');
  await page.getByTestId('pin-add-insights').click();
  await page.getByTestId(`pin-option-${publishedID}`).click();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('saved')).toBeVisible({ timeout: 8_000 });

  await goto(page, '/');
  await expect(page.getByRole('link', { name: /Thinking In Systems/ })).toBeVisible();
}

// ── unpin:MCP page.unpin → 主页收回 ──
async function unpinRemovesCard(page: Page, playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  const res = await callTool<PinResult>(request, apiToken, mcpSID, 'page.unpin',
    { section: 'insights', wiki_id: publishedID });
  expect(res.pinned).toEqual([]);
  await request.dispose();
  await goto(page, '/');
  await expect(page.getByText("things I've been thinking about")).toHaveCount(0);
}

async function loginViaGUI(page: Page): Promise<void> {
  await goto(page, '/login');
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/admin/, { timeout: 8_000 });
}
