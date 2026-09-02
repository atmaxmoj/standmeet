// reader-scoped-gated-entry.spec.ts —— F-L-11 bearer-aware reader: an invited viewer must be able to
// READ a gated (unpublished) wiki entry their code opens. The reader page SSR-fetches the landing
// anonymously (published-only, for SEO), so a gated entry comes back 404 → RestrictedDoc even for a
// viewer who is in scope. `WikiReaderClient` re-fetches the landing WITH the stored visitor token on
// mount and swaps in the entry body when the backend serves it (in the code role's corpus glob) —
// "published (anonymous) + code (invited scope)".
//
// Drives a REAL invited session: a GATED entry (not published) + a code whose role grants wiki://**,
// then asserts the entry body renders (not RestrictedDoc). RED before the fix: SSR-anonymous → 404 →
// the body never appears.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'gated-reader@example.com', password: 'correct-horse-battery-staple',
  handle: 'gatedreader', fullName: 'Gated Reader Owner',
};
// A gated (NOT published) note with a distinctive body sentence to assert on.
const NOTE = { title: 'private-note', path: 'private-note', body: 'The gated body only a code can read.' };
const CODE = 'GATEDREAD-1';

test.describe('F-L-11 · invited viewer reads a gated entry via the bearer-aware reader', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedGatedNoteAndCode(request);
    await request.dispose();
  });

  test('a gated entry renders its body for an invited viewer (not RestrictedDoc)',
    async ({ page }) => {
      await enterCodeSession(page, CODE, 'Reader');
      await goto(page, `/wiki/${NOTE.path}`);
      // The bearer re-fetch swaps in the real entry body.
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 8_000 });
      await expect(page.getByTestId('wiki-body')).toContainText(NOTE.body, { timeout: 8_000 });
    });

  // F-L-11 part B: the sidebar stats are owner-level totals, so an ANONYMOUS viewer of an all-gated
  // corpus used to see "N entries · N gated" over an empty tree — a boast they can't browse. The
  // footer now carries an honest "these entries are private — enter a code" link in exactly that
  // case (no session + published count 0), and never for an invited viewer.
  test('anonymous /wiki on an all-gated corpus shows the honest enter-a-code hint',
    async ({ page }) => {
      await goto(page, '/wiki');
      await expect(page.getByTestId('wiki-tree-gated-hint')).toBeVisible({ timeout: 5_000 });
    });

  // F-L-14 — within the same invited session, four surfaces give two different
  // answers to the same question: the sidebar tree lists this entry, the entry page
  // opens, retrieval can find it, but **the /wiki index** lists only published
  // entries, with a footer that still reads "N GATED".
  // The cause is two separate gates: the index checks the entry's own published
  // flag, while the other three check this session's corpus grant.
  // So an invited visitor's first glance at the corpus looks "empty and locked".
  //
  // This case aligns the index and its footer with the other three: whatever is
  // readable gets listed, and the gated count reports how many entries are closed
  // **to this specific visitor**.
  test('the /wiki index and its counter answer for THIS session, not for an anonymous one (F-L-14)',
    async ({ page }) => {
      await enterCodeSession(page, CODE, 'Reader');
      await goto(page, '/wiki');
      await expect(page.getByTestId('wiki-index')).toBeVisible({ timeout: 8_000 });
      await expect(
        page.getByTestId('wiki-index-roots'),
        '树里列得出、条目页打得开的那条,索引也必须列得出',
      ).toContainText(NOTE.title, { timeout: 8_000 });
      await expect(
        page.getByTestId('wiki-tree-stats'),
        'grant 给了 wiki://**,那对这位访客就一条都没关着',
      ).toContainText(/0\s+gated/i, { timeout: 8_000 });
    });
});

async function seedGatedNoteAndCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'gated-reader-seed');
  const sid = await initMCP(request, apiToken);
  // Seed the note but DO NOT publish it → invisible to anonymous SSR, readable only via the token.
  await seedWiki(request, apiToken, sid, { body: NOTE.body, title: NOTE.title, path: NOTE.path });
  const role = await createRole(request, csrf, { name: 'gated-read', corpus_uris: ['wiki://**'] });
  await createCode(request, csrf, { code: CODE, label: 'gated-read', assumed_role_id: role.id });
}
