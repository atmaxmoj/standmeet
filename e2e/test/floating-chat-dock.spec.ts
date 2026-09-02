// floating-chat-dock.spec.ts —— FloatingChatDock on writings and wiki pages.
//
// User story:
//   1. writings index → the pill is visible (when there's a session)
//   2. no session → the pill doesn't render
//   3. click the pill → the panel expands → input is visible
//   4. type → ask → the answer renders
//   5. close the panel → the pill returns

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto, enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'dock-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'dockowner',
  fullName: 'Dock Owner',
};

const CODE = 'DOCK-001';

test.describe('FloatingChatDock on writings/wiki pages', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('public visitor → no floating pill on /writings (no funded chat path)',
    async ({ page }) => {
      // Public visitor has no session → no inference funding (owner won't pay
      // for random visitors, no BYOAI key). Pill hidden until visitor either
      // absorbs a code or adds BYOAI on /gate.
      await goto(page, '/writings');
      await expect(page.getByTestId('floating-dock-pill')).toHaveCount(0);
    });

  test('with session → pill visible → click → expand → chat → close',
    async ({ page }) => {
      // Absorb code first
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // Navigate to writings
      await goto(page, '/writings');
      // Pill should be visible
      const pill = page.getByTestId('floating-dock-pill');
      await expect(pill).toBeVisible({ timeout: 5_000 });
      // Click pill → panel expands
      await pill.click();
      const panel = page.getByTestId('floating-chat-panel');
      await expect(panel).toBeVisible({ timeout: 3_000 });
      const input = panel.locator('input');
      await expect(input).toBeVisible();
      // Close panel
      await page.getByTestId('floating-dock-pill').click();
      await expect(panel).toBeHidden({ timeout: 3_000 });
      // Pill still there
      await expect(pill).toBeVisible();
    });

  // #35: the floating dock reuses the main chat's ChatTranscript — the big chat's
  // rendering behavior also holds in the small chat.
  // Same testids: answer-pending (throbber) + answer-body (ChatMarkdown), no longer
  // crude plain text.
  test('dock reuses main-chat rendering: ask → throbber + answer-body (no reset)',
    async ({ page }) => {
      await enterCodeSession(page, CODE);
      await goto(page, '/writings');
      await page.getByTestId('floating-dock-pill').click();
      const panel = page.getByTestId('floating-chat-panel');
      await expect(panel).toBeVisible({ timeout: 3_000 });
      // No reset button (removed at the owner's request).
      await expect(panel.getByRole('button', { name: /reset/i })).toHaveCount(0);

      const input = page.getByTestId('floating-chat-input');
      await input.fill('tell me about yourself');
      await input.press('Enter');
      // The same throbber + answer-body as the main chat (the real ChatMarkdown
      // rendering pipeline).
      await expect(panel.getByTestId('answer-pending')).toBeVisible({ timeout: 5_000 });
      await expect(panel.getByTestId('answer-body')).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByTestId('answer-body')).toContainText(/./);
    });

  // #35 completeness (owner's principle): the big chat's full flow of tool-cards +
  // citations + throbber-clears also holds in the small chat (floating dock) —
  // same seed (Lucerna), same question, same testids.
  test('dock full flow: corpus_search 卡 + hit + citations + throbber 清除', dockFullFlow);

  // #36: asking from the doc-page floating dock → the turn request carries the
  // current doc's doc_context (plumbing; reference quality is covered by eval).
  test('location-aware: dock turn 带当前 doc 的 doc_context', dockSendsDocContext);
});

async function dockFullFlow({ page }: { page: Page }): Promise<void> {
  await enterCodeSession(page, CODE);
  await goto(page, '/writings');
  await page.getByTestId('floating-dock-pill').click();
  const panel = page.getByTestId('floating-chat-panel');
  await expect(panel).toBeVisible({ timeout: 3_000 });

  // Mock is pure registration: register corpus_search (renders the SearchHitsCard)
  // + corpus_read (records the citation) for this turn; embed both tags.
  const searchTag = await scriptMockToolCall(page.request, {
    name: 'corpus_search', args: { query: 'lucerna' },
  });
  const readTag = await scriptMockToolCall(page.request, {
    name: 'corpus_read', args: { path: 'projects/lucerna' },
  });

  const input = page.getByTestId('floating-chat-input');
  await input.fill(`tell me about lucerna${searchTag}${readTag}`);
  await input.press('Enter');

  // Retrieval collapses into a single retrieval-summary line (UX-10: no longer
  // rendering a per-tool iframe card); the precise assertion of which doc was hit is
  // handled by citation-row (data-citation-path) below.
  await expect(panel.getByTestId('retrieval-summary'))
    .toBeVisible({ timeout: 20_000 });
  await expect(panel.getByTestId('retrieval-summary')).toContainText('searched');
  // corpus_read renders no card (Citation handles it); citations appear.
  await expect(panel.getByTestId('tool-card-corpus_read')).toHaveCount(0);
  await expect(panel.getByTestId('citations')).toBeVisible();
  // The citation row is an external link jumping to that public page.
  await panel.getByTestId('citations').locator('summary').click();
  const row = panel.locator('[data-testid="citation-row"][data-citation-path="projects/lucerna"]');
  await expect(row).toHaveAttribute('href', '/wiki/projects/lucerna');
  await expect(row).toHaveAttribute('target', '_blank');
  // The throbber disappears once the answer lands.
  await expect(panel.getByTestId('tool-throbbers')).toHaveCount(0, { timeout: 20_000 });
}

// dockSendsDocContext — asking from the floating dock on a wiki landing page, the
// turn request carries doc_context (title/path/genre), which the backend injects
// into the instruction so the AI can resolve "this/this piece" references.
type TurnBody = { doc_context?: { title: string; path: string; genre: string } };

async function dockSendsDocContext({ page }: { page: Page }): Promise<void> {
  await enterCodeSession(page, CODE);
  let turnBody: TurnBody | null = null;
  await page.route('**/api/v1/agent/turn', async (route) => {
    turnBody = route.request().postDataJSON() as TurnBody;
    await route.continue();
  });
  await goto(page, '/wiki/projects/lucerna');
  await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('floating-dock-pill').click();
  const input = page.getByTestId('floating-chat-input');
  await input.fill('tell me more about this');
  await input.press('Enter');
  await expect(page.getByTestId('floating-chat-panel').getByTestId('answer-body'))
    .toBeVisible({ timeout: 15_000 });
  // turnBody is only assigned inside the route closure → TS's control-flow analysis
  // narrows it to null; explicitly cast it back to the union at the read site.
  expect((turnBody as TurnBody | null)?.doc_context).toMatchObject({
    title: 'Lucerna', path: 'projects/lucerna', genre: 'wiki',
  });
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'dock-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'dock owner intro.', title: 'Dock Intro',
  });
  // Lucerna — lets the mock run corpus_search → cite in the small chat too (mirroring
  // the big chat's full flow).
  // Marked indexed so the /wiki/projects/lucerna landing page can render (used by the
  // location-aware plumbing test).
  const luc = await seedWiki(request, apiToken, sid, {
    body: 'lucerna is a local-first knowledge tool.',
    title: 'Lucerna', path: 'projects/lucerna',
  });
  await callTool(request, apiToken, sid, 'seo.set_entry_seo', {
    genre: 'wiki', id: luc.wikiID, excerpt: 'a local-first knowledge tool', published: true,
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Dock test',
  });
  await request.dispose();
}
