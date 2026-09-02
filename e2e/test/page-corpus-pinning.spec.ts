// page-corpus-pinning.spec.ts — the homepage's insights/projects sections are pin lists over the
// corpus (docs/design/page-corpus-pinning.md).
//
// Ideas are stored exactly once: a section stores wiki id references, and rendering joins in
// title+excerpt and links out to /wiki/…. The invariant pinned ⊆ published is maintained at
// both write points:
//   • page.pin rejects an unpublished entry ("publish it first")
//   • unpublishing an already-pinned entry → succeeds + auto-unpins + declares it in the tool
//     result
// An empty section renders nothing at all (not even its header).

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
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

  // **The other face** of the same invariant. The case above verifies that `unpinned_sections`
  // speaks up in the MCP tool result; what the owner more often actually does is flip that
  // published toggle off in the admin panel, and on that path the product only replied "Wiki
  // saved" — one click did two things (changed visibility, and **removed a card from their own
  // homepage**), and only the first one was reported back (F-L-31). The receipt itself has always
  // existed on the backend (`unpinned_sections` in `seo.go`) — it's the client's `patchVoid` that
  // discards the response.
  test('unpublishing from the admin form says the pin went with it',
    async ({ page, playwright }) => { await adminUnpublishSaysUnpinned(page, playwright); });

  // Every other case in this spec **hand-delivers an excerpt to the product**
  // (`publishEntry(… excerpt: EXCERPT_A)`), so the fact that "notes in the real vault have no
  // excerpt at all" never once occurred here ([[stand-in-is-politer-than-reality]]). Out of 1047
  // real corpus entries, exactly **0** have a non-empty excerpt — sync never produces one, and
  // the prose body lives entirely inside a two-level `> > ` blockquote (that's what the i18n
  // contract dictates).
  test('真 vault 那种笔记（没有 excerpt、正文包在 i18n 里）也要有一句人话',
    async ({ page, playwright }) => { await vaultShapedCardHasALine(page, playwright); });
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
  await publishEntry(request, apiToken, mcpSID,
    { genre: 'wiki', id: publishedID, excerpt: EXCERPT_A });
  const b = await seedWiki(request, apiToken, mcpSID, {
    title: 'Gated Thought', body: 'Not for the public page.', path: 'gated-thought',
  });
  gatedID = b.wikiID;
  await request.dispose();
}

// ── Seed: MCP page.pin(a published entry) → the homepage renders a card (title+excerpt+/wiki link) ──
async function pinRendersCard(page: Page, playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  const res = await callTool<PinResult>(request, apiToken, mcpSID, 'page.pin',
    { section: 'insights', wiki_id: publishedID });
  expect(res.pinned, 'pin list holds the entry').toContain(publishedID);
  await request.dispose();

  await goto(page, '/');
  await expect(page.getByText("things I've been thinking about")).toBeVisible();
  // The card = the entry's title + excerpt, linking out to the reader — not a second copy of
  // the content.
  const link = page.getByRole('link', { name: /Thinking In Systems/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/wiki/thinking-in-systems');
  await expect(page.getByText(EXCERPT_A)).toBeVisible();
}

// ── Invariant endpoint 1: pinning something unpublished → rejected at the write point ──
async function pinUnpublishedRejected(playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  await expect(async () => {
    await callTool(request, apiToken, mcpSID, 'page.pin',
      { section: 'insights', wiki_id: gatedID });
  }).rejects.toThrow(/publish/i);
  // admin PUT hits the same URI surface and is rejected by that same single maintainer (one
  // maintenance point, not a duplicate implementation).
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const current = await (await request.get(`${BACKEND}/api/admin/page`)).json() as AdminPage;
  const put = await request.put(`${BACKEND}/api/admin/page`, {
    headers: { 'X-Csrftoken': csrf },
    data: { ...current, insights: [...current.insights, gatedID] },
  });
  expect(put.status(), 'admin PUT with an unpublished pin → 400').toBe(400);
  await request.dispose();
}

// ── Invariant endpoint 2: unpublishing an already-pinned entry → succeeds + auto-unpins +
// declares it ──
async function unpublishDropsCard(page: Page, playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  const res = await callTool<SetSEOResult>(request, apiToken, mcpSID, 'seo.set_entry_seo',
    { genre: 'wiki', id: publishedID, excerpt: EXCERPT_A, published: false });
  expect(res.published).toBe(false);
  expect(res.unpinned_sections, 'the side effect is declared in the tool result')
    .toContain('insights');
  // Storage side: the pin list is now empty.
  await loginAPI(request, OWNER.email, OWNER.password);
  const admin = await (await request.get(`${BACKEND}/api/admin/page`)).json() as AdminPage;
  expect(admin.insights, 'pin removed from the stored page').toEqual([]);
  await request.dispose();

  // Render side: the empty section disappears entirely (not even its header renders).
  await goto(page, '/');
  await expect(page.getByText("things I've been thinking about")).toHaveCount(0);
  await expect(page.getByText('Thinking In Systems')).toHaveCount(0);
}

// ── Empty state: a section with nothing pinned doesn't even render its header ──
async function emptySectionsHidden(page: Page): Promise<void> {
  await goto(page, '/');
  await expect(page.getByText("things I've been thinking about")).toHaveCount(0);
  await expect(page.getByText("what I'm building")).toHaveCount(0);
}

// ── admin GUI: the pin manager picks from published entries, and saving renders it on the
// homepage ──
async function adminPinManagerRenders(page: Page, playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  await publishEntry(request, apiToken, mcpSID,
    { genre: 'wiki', id: publishedID, excerpt: EXCERPT_A });
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

// ── unpin: MCP page.unpin → the homepage takes the card back down ──
async function unpinRemovesCard(page: Page, playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  const res = await callTool<PinResult>(request, apiToken, mcpSID, 'page.unpin',
    { section: 'insights', wiki_id: publishedID });
  expect(res.pinned).toEqual([]);
  await request.dispose();
  await goto(page, '/');
  await expect(page.getByText("things I've been thinking about")).toHaveCount(0);
}

// ── admin GUI: unpublishing a pinned entry → the receipt must say "the pin went with it" ──
async function adminUnpublishSaysUnpinned(page: Page, playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  await publishEntry(request, apiToken, mcpSID,
    { genre: 'wiki', id: publishedID, excerpt: EXCERPT_A });
  await request.dispose();

  await loginViaGUI(page);
  // Pin it first — the positive control: without a pin, "the receipt doesn't mention pin" would
  // be correct, and this case would test nothing at all.
  await goto(page, '/admin/page');
  await page.getByTestId('pin-add-insights').click();
  await page.getByTestId(`pin-option-${publishedID}`).click();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('saved')).toBeVisible({ timeout: 8_000 });

  // Then go to the entry's own table and turn published off.
  await goto(page, '/admin/wiki');
  await page.getByTestId(`wiki-edit-${publishedID}`).click();
  await page.getByTestId(`wiki-${publishedID}-seo-indexed`).click();
  await page.getByTestId(`wiki-${publishedID}-seo-save`).click();

  await expect(
    page.getByTestId('toaster'),
    'the owner just did two things in one click — changed a note’s visibility and removed a card '
      + 'from their own landing page. A receipt that only says "saved" acknowledges one of them',
  ).toContainText(/insights/i, { timeout: 10_000 });
}

// VAULT_SHAPED — what a note in the real vault actually looks like: the prose lives entirely
// inside a two-level `> > ` blockquote (the i18n contract), preceded by callout markup and the
// HTML for that row of language buttons, with the heading line as `# …`. **No excerpt is set** —
// sync never produces one.
const VAULT_SHAPED = [
  '> [!i18n]',
  '> <label><input type="radio" name="vs-lang" checked>EN</label><label>中文</label>',
  '>',
  '> > [!lang] en',
  '> > # Contraction keeps recursion honest',
  '> > A gate is worth its cost only when reassembly damps error instead of amplifying it.',
].join('\n');
const VAULT_LEAD = 'A gate is worth its cost only when reassembly damps error';

// vaultShapedCardHasALine — the homepage's pin card must still say what this note is about even
// when fed **real-corpus-shaped data**. Two criteria, both required: (a) there's a genuine
// human-readable line from the body; (b) that line is not raw markup — "something is displayed"
// and "what's displayed is actually readable" are two different things
// ([[display-fallback-reintroduces-the-bug]]).
async function vaultShapedCardHasALine(page: Page, playwright: PW): Promise<void> {
  const request = await playwright.request.newContext();
  const n = await seedWiki(request, apiToken, mcpSID,
    { title: 'Vault Shaped', body: VAULT_SHAPED, path: 'vault-shaped' });
  await publishEntry(request, apiToken, mcpSID, { genre: 'wiki', id: n.wikiID });
  await callTool(request, apiToken, mcpSID, 'page.pin',
    { section: 'insights', wiki_id: n.wikiID });
  await request.dispose();

  await goto(page, '/');
  const card = page.getByTestId('insight-card-vault-shaped');
  await expect(card).toBeVisible({ timeout: 8_000 });
  const text = await card.innerText();
  expect(text, '卡上要有正文里的那句人话,不能只剩一个 slug').toContain(VAULT_LEAD);
  expect(text, '不许把 callout / 切换器的原始标记摆给访客').not.toMatch(/\[!|<label|<input|radio/);
}

async function loginViaGUI(page: Page): Promise<void> {
  await goto(page, '/login');
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/admin/, { timeout: 8_000 });
}
