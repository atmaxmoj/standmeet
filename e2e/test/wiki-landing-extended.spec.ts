// wiki-landing-extended.spec.ts —— wiki landing extended: private wiki,
// AskAboutThis, 404 slug.
//
// 用户故事：
//   1. cover hero 渲染 (title + date)
//   2. private wiki + 没 code → LockedView
//   3. AskAboutThis (kind=wiki) → /?q=...
//   4. 不存在的 slug → 404

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { publishEntry, seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'wiki-ext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'wikiext',
  fullName: 'Wiki Ext Owner',
};

// 14 个 case 分成 4 组注册 —— 原本全堆在一个 describe 回调里(138 行,超
// max-lines-per-function 70)。拆成 registerXxx() 每组各自 <70 行,describe 只
// 串起来,执行顺序不变(test() 注册顺序 = 运行顺序)。
test.describe('wiki landing extended cases', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  registerHeroTests();
  registerLayoutTests();
  registerSidebarSessionTests();
  registerGraphTests();
});

// registerHeroTests —— cover hero / locked / metadata strip / no inline ask。
function registerHeroTests(): void {
  test('wiki page shows cover hero with title and date',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await goto(page, '/wiki/wiki-extended');
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('heading', { name: 'Wiki Extended' })).toBeVisible();
    });

  test('nonexistent wiki slug → locked view',
    async ({ page }) => {
      await goto(page, '/wiki/nonexistent-wiki-slug-xyz');
      await expect(page.getByText('This entry requires an access code'))
        .toBeVisible({ timeout: 5_000 });
    });

  test('metadata strip: cover tag + tag chips + by owner full name',
    async ({ request, page }) => {
      await seedTaggedWiki(request);
      await goto(page, '/wiki/tagged-entry');
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      // cover 角标用首个 tag(不再写死 corpus)。
      await expect(page.getByTestId('wiki-cover')).toContainText('wiki · lucerna');
      // 元信息行:tag chips + owner 全名(不是 handle)。
      const meta = page.getByTestId('wiki-meta');
      await expect(meta).toContainText('#lucerna');
      await expect(meta).toContainText('#eval');
      await expect(meta).toContainText('#thinking');
      await expect(meta).toContainText('Wiki Ext Owner');
    });

  // owner: 底部内联问答条不要了 —— 现在 wiki 页不渲 AskAboutThis。
  test('wiki page has no inline ask-about-this composer',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await goto(page, '/wiki/wiki-extended');
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('article-ask-form')).toHaveCount(0);
    });
}

// registerLayoutTests —— breadcrumb / sticky toc / long-scroll / TopBar。
function registerLayoutTests(): void {
  // owner: 每种 document 返回自己那类 —— wiki 的「← back」回 /wiki,不是 /writings。
  test('wiki breadcrumb back link goes to /wiki (its own index), not /writings',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await goto(page, '/wiki/wiki-extended');
      const back = page.getByTestId('wiki-breadcrumb').getByRole('link', { name: '← wiki' });
      await expect(back).toHaveAttribute('href', '/wiki');
      await back.click();
      await page.waitForURL('**/wiki');
      await expect(page.getByTestId('wiki-index')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('wiki-index-roots')).toContainText('Wiki Extended');
    });

  // owner: 左边 toc 别跟文章滚 —— sticky,文档滚动时钉在视口上沿(strip 下)。
  test('left wiki toc is sticky — stays pinned when the page scrolls',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await page.setViewportSize({ width: 1280, height: 720 });
      await goto(page, '/wiki/wiki-extended');
      const aside = page.getByTestId('wiki-toc');
      await expect(aside).toBeVisible({ timeout: 5_000 });
      await page.evaluate(() => window.scrollTo(0, 1500));
      const top = await aside.evaluate((el) => el.getBoundingClientRect().top);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThan(60); // 钉在 strip(29px)下面,没被文章带走
    });

  // owner: 文章再长也要能滚到底(about box 露出来,不被 fixed dock 永久盖住)。
  test('long article scrolls all the way to the bottom (about box reachable)',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await page.setViewportSize({ width: 1280, height: 720 });
      await goto(page, '/wiki/wiki-extended');
      const about = page.getByText('about this entry');
      await about.scrollIntoViewIfNeeded();
      await expect(about).toBeInViewport({ timeout: 5_000 });
    });

  // owner: header 永远在(无 session 也在)+ 分支导航 + 能切主题。
  test('reader TopBar renders branding, nav, and a working theme toggle',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await goto(page, '/wiki/wiki-extended');
      const bar = page.getByTestId('wiki-topbar');
      await expect(bar).toBeVisible({ timeout: 5_000 });
      await expect(bar).toContainText('standmeet');
      await expect(bar).toContainText('wiki');
      await expect(bar.getByRole('link', { name: 'writing' })).toHaveAttribute('href', '/writings');
      const before = await page.evaluate(() =>
        document.documentElement.classList.contains('dark'));
      await page.getByTestId('wiki-theme-toggle').click();
      await expect.poll(() => page.evaluate(() =>
        document.documentElement.classList.contains('dark'))).toBe(!before);
    });
}

// registerSidebarSessionTests —— flush-left sidebar / code session / no session / nesting。
function registerSidebarSessionTests(): void {
  // owner: toc 贴最左 + 有分割线(可拖)+ 树抬头/统计都在。
  test('sidebar is flush-left with a resize divider, header, and stats',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await page.setViewportSize({ width: 1280, height: 720 });
      await goto(page, '/wiki/wiki-extended');
      const toc = page.getByTestId('wiki-toc');
      await expect(toc).toBeVisible({ timeout: 5_000 });
      const box = await toc.boundingBox();
      expect(box?.x ?? 99).toBeLessThan(4); // 贴左沿
      // 分割线(把手)全高:撑满文章,比 toc 内容高得多 —— 竖线不能只画到 toc 底。
      const handleBox = await page.getByTestId('wiki-toc-resize').boundingBox();
      expect(handleBox?.height ?? 0).toBeGreaterThan(box?.height ?? 0);
      await expect(page.getByTestId('wiki-tree')).toContainText('wiki tree');
    });

  // owner: 有 code 会话 → strip 显示 invited(不是 anonymous)+ ask dock 渲染。
  test('with a code session: strip shows invited and the ask dock renders',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      await createCode(request, csrf, { code: 'READER-PASS', label: 'Reader access' });
      await enterCodeSession(page, 'READER-PASS', 'Sam');
      await goto(page, '/wiki/wiki-extended');
      await expect(page.getByTestId('session-strip')).toContainText('invited', { timeout: 5_000 });
      await expect(page.getByTestId('floating-dock-pill')).toBeVisible();
    });

  // owner: dock 只在有 AI(code/BYOAI)时出 —— 无会话(public)时不渲染。
  test('without a session: the ask dock does not render (AI not powering)',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await goto(page, '/wiki/wiki-extended');
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('floating-dock-pill')).toHaveCount(0);
    });

  // owner: 是真树 —— 子条目嵌在父下面,落到子条目时祖先链自动展开。
  test('sidebar nests child under parent and auto-expands to the current entry',
    async ({ request, page }) => {
      const { parentTitle, childTitle, childPath } = await seedNestedWiki(request);
      await goto(page, `/wiki/${childPath}`);
      const tree = page.getByTestId('wiki-tree');
      await expect(tree).toContainText(parentTitle, { timeout: 5_000 });
      // 懒加载 + openPaths(当前条前缀)自动展开到当前 → 子条这层被取、可见。
      await expect(tree.getByTestId(`tree-node-${childPath}`)).toBeVisible({ timeout: 5_000 });
      await expect(tree).toContainText(childTitle);
    });
}

// registerGraphTests —— [[wikilink]] 渲染 + cited-by/related 反向图。
function registerGraphTests(): void {
  // owner: Obsidian 双链 —— body 里 [[Title]] 渲染成可点的 /wiki/<path> 链接。
  test('a [[Title]] wikilink in a wiki body renders as a clickable /wiki link',
    async ({ request, page }) => {
      const { srcPath, dstPath, dstTitle } = await seedLinkedWikis(request);
      await goto(page, `/wiki/${srcPath}`);
      const link = page.getByTestId('wiki-body').getByRole('link', { name: dstTitle });
      await expect(link).toHaveAttribute('href', `/wiki/${dstPath}`, { timeout: 5_000 });
    });

  // owner: 写的体验 —— 往 A 写 [[B]] 就在图里建了 A→B 边,B 的 landing 反向露出
  // cited_by(含 A),A 的 landing 露出 related(含 B)。= Obsidian 写完即有 backlink。
  test('writing [[Target]] into a wiki builds the cited-by / related graph',
    async ({ request }) => {
      const { srcTitle, srcPath, dstTitle, dstPath } = await seedLinkedWikis(request);
      const dst = await (await request.get(`${BACKEND}/api/v1/wiki/${dstPath}`)).json() as Landing;
      expect((dst.cited_by ?? []).map((r) => r.title)).toContain(srcTitle);
      const src = await (await request.get(`${BACKEND}/api/v1/wiki/${srcPath}`)).json() as Landing;
      expect((src.related ?? []).map((r) => r.title)).toContain(dstTitle);
    });
}

type Landing = {
  related?: Array<{ title: string; path: string }>;
  cited_by?: Array<{ title: string; path: string }>;
};

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function seedIndexedWiki(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'wiki-ext-seed');
  const sid = await initMCP(request, token);
  // 长 body：让 landing 高过视口,sticky 侧栏测试能滚 1500px。
  const longBody = Array.from(
    { length: 40 },
    (_, i) => `## Section ${i + 1}\n\nExtended wiki content for testing, paragraph ${i + 1}. `
      + 'This entry is intentionally long so the page scrolls past the viewport.',
  ).join('\n\n');
  const { wikiID } = await seedPublicWiki(request, token, sid, {
    body: longBody,
    title: 'Wiki Extended',
  });
  await publishEntry(request, token, sid, {
    genre: 'wiki', id: wikiID, excerpt: 'Extended wiki test.',
  });
}

async function seedTaggedWiki(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'wiki-tagged-seed');
  const sid = await initMCP(request, token);
  const { wikiID } = await seedPublicWiki(request, token, sid, {
    body: 'Tagged wiki content.', title: 'Tagged Entry',
  });
  // tags 只能经 corpus.update 设(promote/seed 不带)。
  await callTool(request, token, sid, 'corpus.update', {
    genre: 'wiki', id: wikiID, title: 'Tagged Entry', body: 'Tagged wiki content.',
    tags: ['lucerna', 'eval', 'thinking'],
  });
  await publishEntry(request, token, sid, {
    genre: 'wiki', id: wikiID, excerpt: 'A tagged wiki.',
  });
}

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// seedNestedWiki —— 父 + 子(子 parent_id=父),都 published,返回子的树派生 path。
async function seedNestedWiki(request: APIRequestContext): Promise<{
  parentTitle: string; childTitle: string; childPath: string;
}> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'wiki-nest-seed');
  const sid = await initMCP(request, token);
  const parentTitle = 'Nest Parent Co';
  const childTitle = 'Nest Child Proj';
  const { wikiID: parentID } = await seedPublicWiki(request, token, sid, {
    body: 'Parent body.', title: parentTitle,
  });
  // 子条直接 promote 时带 parent_id(镜像 seed_persona,稳),不走 corpus.update reparent。
  const dump = await callTool<{ id: string }>(request, token, sid, 'corpus.create', {
    genre: 'raw', body: 'Child body.', source: 'mcp:test', tags: [], private: false,
  });
  const promo = await callTool<{ id: string }>(request, token, sid, 'corpus.promote', {
    genre: 'raw', id: dump.id, title: childTitle, body: 'Child body.', parent_id: parentID,
  });
  const childID = promo.id;
  for (const id of [parentID, childID]) {
    await publishEntry(request, token, sid, { genre: 'wiki', id });
  }
  return { parentTitle, childTitle, childPath: await discoverWikiPath(request, parentID, childID) };
}

// discoverWikiPath —— 经公开 wiki-tree 拿到子条的树派生 path(parent-slug/child-slug)。
async function discoverWikiPath(
  request: APIRequestContext, parentID: string, childID: string,
): Promise<string> {
  const res = await request.get(`${BACKEND}/api/v1/wiki-tree?parent=${parentID}`);
  const body = await res.json() as { nodes: Array<{ id: string; path: string }> };
  return body.nodes.find((n) => n.id === childID)?.path ?? '';
}

// linkSeedSeq —— 每次 seedLinkedWikis 用唯一标题,避免跨 test 撞标题(同名 = 同
// 树派生 path = cited_by/解析按 path 命中错的孪生)。
let linkSeedSeq = 0;

// seedLinkedWikis —— dst(目标)+ src(body 里写 [[dstTitle]]),都 published。
// src 先建 dst 后 promote,所以 promote 时 [[dstTitle]] 能解析 → 建 src→dst 边。
async function seedLinkedWikis(request: APIRequestContext): Promise<{
  srcTitle: string; srcPath: string; dstTitle: string; dstPath: string;
}> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'wiki-link-seed');
  const sid = await initMCP(request, token);
  const n = (linkSeedSeq += 1);
  const dstTitle = `Link Target Entry ${n}`;
  const srcTitle = `Link Source Entry ${n}`;
  const { wikiID: dstID } = await seedPublicWiki(request, token, sid, {
    body: 'Target body.', title: dstTitle,
  });
  const { wikiID: srcID } = await seedPublicWiki(request, token, sid, {
    body: `This links to [[${dstTitle}]] in the corpus.`, title: srcTitle,
  });
  for (const id of [dstID, srcID]) {
    await publishEntry(request, token, sid, { genre: 'wiki', id });
  }
  return {
    srcTitle,
    srcPath: await discoverRootPath(request, srcID),
    dstTitle,
    dstPath: await discoverRootPath(request, dstID),
  };
}

// discoverRootPath —— 公开 wiki-tree 根层里按 id 拿树派生 path。
async function discoverRootPath(request: APIRequestContext, wikiID: string): Promise<string> {
  const res = await request.get(`${BACKEND}/api/v1/wiki-tree`);
  const body = await res.json() as { nodes: Array<{ id: string; path: string }> };
  return body.nodes.find((n) => n.id === wikiID)?.path ?? '';
}
