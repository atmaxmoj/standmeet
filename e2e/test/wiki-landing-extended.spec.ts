// wiki-landing-extended.spec.ts —— wiki landing extended: private wiki,
// AskAboutThis, 404 slug.
//
// User story:
//   1. cover hero renders (title + date)
//   2. private wiki + no code -> LockedView
//   3. AskAboutThis (kind=wiki) -> /?q=...
//   4. a nonexistent slug -> 404

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

// 14 cases registered in 4 groups -- previously all stacked into a single describe
// callback (138 lines, over the max-lines-per-function 70 limit). Split into
// registerXxx() functions, each under 70 lines; the describe just wires them together,
// and the execution order is unchanged (test() registration order = run order).
test.describe('wiki landing extended cases', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  registerHeroTests();
  registerLayoutTests();
  registerSidebarSessionTests();
  registerAboutCardTests();
  registerGraphTests();
});

// registerAboutCardTests -- what the "about this entry" card at the page footer says
// must be something this visitor can actually do.
//
// This same spec already proves: with no session, the dock doesn't render
// (`floating-dock-pill` count 0). So the line "ask follow-ups below" is, for an
// anonymous visitor, **a promise this very page disproves itself** (UX-86).
// Both assertions are written in the same test case specifically so this contradiction
// can't be split across two tests that each pass green on their own.
function registerAboutCardTests(): void {
  test('匿名访客:卡片不许叫他「在下面接着问」,而要给出他真走得到的那条路',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await goto(page, '/wiki/wiki-extended');
      const about = page.getByTestId('reader-about');
      await expect(about).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('floating-dock-pill'), '这一页确实没有入口').toHaveCount(0);
      const text = await about.innerText();
      expect(text, '没有入口就别说「下面」').not.toMatch(/below/i);
      await expect(
        about.getByRole('link', { name: /access code/i }),
        '产品对他有正路:进 /gate 输码',
      ).toHaveAttribute('href', '/gate');
    });

  test('有码会话:卡片才说「在下面接着问」,而那个下面确实在', async ({ request, page }) => {
    await seedIndexedWiki(request);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: 'ABOUT-PASS', label: 'About access' });
    await enterCodeSession(page, 'ABOUT-PASS', 'Robin');
    await goto(page, '/wiki/wiki-extended');
    await expect(page.getByTestId('floating-dock-pill')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('reader-about')).toContainText('below');
  });

  // This instance never stores the owner's gender at all. The card used to literally say
  // "in his voice".
  test('卡片不替 owner 认性别', async ({ request, page }) => {
    await seedIndexedWiki(request);
    await goto(page, '/wiki/wiki-extended');
    const text = await page.getByTestId('reader-about').innerText();
    expect(text, '实例没存过 owner 的性别').not.toMatch(/\b(his|her|hers)\b/i);
  });
}

// registerHeroTests -- cover hero / locked / metadata strip / no inline ask.
function registerHeroTests(): void {
  // The name used to be "shows cover hero with title and date", while what it actually
  // asserted was the h1 in the meta -- never asserting a single hero field. This note
  // never set a hero, so it correctly shouldn't have one (F-L-32: a note with no hero set
  // must not render an empty hero shell), and the name has been changed to what it
  // actually checks: the title landing on the page.
  test('wiki page renders the entry: landing + title',
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
      // The cover badge uses the first tag (no longer hardcoded to "corpus").
      await expect(page.getByTestId('wiki-cover')).toContainText('wiki · lucerna');
      // The metadata row: tag chips + the owner's full name (not the handle).
      const meta = page.getByTestId('wiki-meta');
      await expect(meta).toContainText('#lucerna');
      await expect(meta).toContainText('#eval');
      await expect(meta).toContainText('#thinking');
      await expect(meta).toContainText('Wiki Ext Owner');
    });

  // owner: the inline ask-form at the bottom is gone -- wiki pages no longer render
  // AskAboutThis.
  test('wiki page has no inline ask-about-this composer',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await goto(page, '/wiki/wiki-extended');
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('article-ask-form')).toHaveCount(0);
    });
}

// registerLayoutTests -- breadcrumb / sticky toc / long-scroll / TopBar.
function registerLayoutTests(): void {
  // owner: each document type returns to its own kind -- wiki's "<- back" goes to
  // /wiki, not /writings.
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

  // owner: the left toc shouldn't scroll with the article -- sticky, pinned to the top
  // of the viewport (below the strip) while the document scrolls.
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
      expect(top).toBeLessThan(60); // pinned below the strip (29px), not carried away
                                    // by the article
    });

  // owner: no matter how long the article, it must be able to scroll all the way down
  // (the about box becomes visible, not permanently covered by the fixed dock).
  test('long article scrolls all the way to the bottom (about box reachable)',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await page.setViewportSize({ width: 1280, height: 720 });
      await goto(page, '/wiki/wiki-extended');
      const about = page.getByText('about this entry');
      await about.scrollIntoViewIfNeeded();
      await expect(about).toBeInViewport({ timeout: 5_000 });
    });

  // owner: the header is always present (even with no session) + branch nav + a working
  // theme toggle.
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

// registerSidebarSessionTests -- flush-left sidebar / code session / no session /
// nesting.
function registerSidebarSessionTests(): void {
  // owner: the toc sits flush against the left edge + has a (draggable) resize divider
  // + the tree header/stats are all present.
  test('sidebar is flush-left with a resize divider, header, and stats',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await page.setViewportSize({ width: 1280, height: 720 });
      await goto(page, '/wiki/wiki-extended');
      const toc = page.getByTestId('wiki-toc');
      await expect(toc).toBeVisible({ timeout: 5_000 });
      const box = await toc.boundingBox();
      expect(box?.x ?? 99).toBeLessThan(4); // flush against the left edge
      // The resize divider (handle) spans the full height: it fills the whole article,
      // much taller than the toc's own content -- the vertical line must not stop
      // drawing at the bottom of the toc.
      const handleBox = await page.getByTestId('wiki-toc-resize').boundingBox();
      expect(handleBox?.height ?? 0).toBeGreaterThan(box?.height ?? 0);
      await expect(page.getByTestId('wiki-tree')).toContainText('wiki tree');
    });

  // owner: with a code session -> the strip names what **this specific code** grants
  // (not "anonymous", and not the generic `invited` line said for every code) + the ask
  // dock renders.
  //
  // The assertion was changed from `invited` to the code's own label: `SessionStrip.tsx:
  // 107` reads `s.label ?? 'invited'`, and `invited` is the fallback for **when there's
  // no label**. Using the fallback as the criterion makes a named code and an unnamed
  // code look identical to this guard -- which is exactly what UX-68 documented (the top
  // strip saying the same word for every code).
  test('with a code session: the strip names this code’s access and the ask dock renders',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      await createCode(request, csrf, { code: 'READER-PASS', label: 'Reader access' });
      await enterCodeSession(page, 'READER-PASS', 'Sam');
      await goto(page, '/wiki/wiki-extended');
      const strip = page.getByTestId('session-strip');
      await expect(strip).toContainText('Reader access', { timeout: 5_000 });
      await expect(strip, 'a named code must not be reported as anonymous').not.toContainText('anonymous');
      await expect(page.getByTestId('floating-dock-pill')).toBeVisible();
    });

  // Theme is a **whole-document** setting, not a per-page one: clicking dark on the
  // reader page must still be dark once you get to the chat surface.
  // A visitor with a code spends most of their time on the chat surface, and that
  // surface **never read this preference at all** before (UX-94).
  test('在读者页切到 dark，带码进聊天面还是 dark', async ({ request, page }) => {
    await seedIndexedWiki(request);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: 'THEME-PASS', label: 'Theme access' });
    await enterCodeSession(page, 'THEME-PASS', 'Nour');

    await goto(page, '/wiki/wiki-extended');
    await page.getByTestId('wiki-theme-toggle').click();
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.classList.contains('dark'))).toBe(true);

    await goto(page, '/');
    await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 8_000 });
    await expect.poll(
      () => page.evaluate(() => document.documentElement.classList.contains('dark')),
      { timeout: 5_000 },
    ).toBe(true);
  });

  // owner: the dock only appears when there's an AI (code/BYOAI) -- doesn't render
  // without a session (public).
  test('without a session: the ask dock does not render (AI not powering)',
    async ({ request, page }) => {
      await seedIndexedWiki(request);
      await goto(page, '/wiki/wiki-extended');
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('floating-dock-pill')).toHaveCount(0);
    });

  // owner: it's a real tree -- a child entry nests under its parent, and landing on a
  // child auto-expands its ancestor chain.
  test('sidebar nests child under parent and auto-expands to the current entry',
    async ({ request, page }) => {
      const { parentTitle, childTitle, childPath } = await seedNestedWiki(request);
      await goto(page, `/wiki/${childPath}`);
      const tree = page.getByTestId('wiki-tree');
      await expect(tree).toContainText(parentTitle, { timeout: 5_000 });
      // Lazy loading + openPaths (the current entry's prefix) auto-expands to the
      // current entry -> the child's level gets fetched and becomes visible.
      await expect(tree.getByTestId(`tree-node-${childPath}`)).toBeVisible({ timeout: 5_000 });
      await expect(tree).toContainText(childTitle);
    });
}

// registerGraphTests -- [[wikilink]] rendering + the cited-by/related backlink graph.
function registerGraphTests(): void {
  // owner: Obsidian-style bidirectional links -- a [[Title]] in the body renders as a
  // clickable /wiki/<path> link.
  test('a [[Title]] wikilink in a wiki body renders as a clickable /wiki link',
    async ({ request, page }) => {
      const { srcPath, dstPath, dstTitle } = await seedLinkedWikis(request);
      await goto(page, `/wiki/${srcPath}`);
      const link = page.getByTestId('wiki-body').getByRole('link', { name: dstTitle });
      await expect(link).toHaveAttribute('href', `/wiki/${dstPath}`, { timeout: 5_000 });
    });

  // owner: the writing experience -- writing [[B]] into A builds an A->B edge in the
  // graph; B's landing shows the reverse cited_by (including A), and A's landing shows
  // related (including B). = Obsidian's "backlink shows up as soon as you write it".
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
  // A long body: makes the landing taller than the viewport so the sticky-sidebar test
  // can scroll 1500px.
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
  // tags can only be set through corpus.update (promote/seed don't carry them).
  // cover_headline -- the owner wrote a line for the hero, which means **they want this
  // hero**. Without it, this note correctly shouldn't have a cover (F-L-32: a note with
  // no hero set must not render an empty shell), and the assertion below guards the
  // caption text printed on that cover.
  // **cover_hue cannot be used as that evidence**: `cover_hue`'s library default is
  // already `amber`, so every note has it non-empty, making it "the owner set a hero" as
  // a criterion vacuously true.
  await callTool(request, token, sid, 'corpus.update', {
    genre: 'wiki', id: wikiID, title: 'Tagged Entry', body: 'Tagged wiki content.',
    tags: ['lucerna', 'eval', 'thinking'], cover_headline: 'a tagged cover',
  });
  await publishEntry(request, token, sid, {
    genre: 'wiki', id: wikiID, excerpt: 'A tagged wiki.',
  });
}

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// seedNestedWiki -- a parent + a child (child's parent_id = parent), both published,
// returns the child's tree-derived path.
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
  // The child is promoted directly with a parent_id (mirroring seed_persona, which is
  // stable), rather than going through a corpus.update reparent.
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

// discoverWikiPath -- gets the child entry's tree-derived path (parent-slug/child-slug)
// through the public wiki-tree.
async function discoverWikiPath(
  request: APIRequestContext, parentID: string, childID: string,
): Promise<string> {
  const res = await request.get(`${BACKEND}/api/v1/wiki-tree?parent=${parentID}`);
  const body = await res.json() as { nodes: Array<{ id: string; path: string }> };
  return body.nodes.find((n) => n.id === childID)?.path ?? '';
}

// linkSeedSeq -- each seedLinkedWikis call uses a unique title to avoid title collisions
// across tests (same name = same tree-derived path = cited_by/resolution matching the
// wrong sibling by path).
let linkSeedSeq = 0;

// seedLinkedWikis -- dst (the target) + src (whose body writes [[dstTitle]]), both
// published. src is created before dst is promoted, so at promote time [[dstTitle]] can
// resolve -> building the src->dst edge.
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

// discoverRootPath -- gets the tree-derived path by id from the public wiki-tree's root
// level.
async function discoverRootPath(request: APIRequestContext, wikiID: string): Promise<string> {
  const res = await request.get(`${BACKEND}/api/v1/wiki-tree`);
  const body = await res.json() as { nodes: Array<{ id: string; path: string }> };
  return body.nodes.find((n) => n.id === wikiID)?.path ?? '';
}
