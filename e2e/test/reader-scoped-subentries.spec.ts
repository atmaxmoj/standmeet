// reader-scoped-subentries.spec.ts —— F-L-13: an invited viewer's reader entry page must list its
// GATED child entries in the sub-entries rail. The page SSR-fetches the wiki context anonymously
// (published-only), so a gated child is filtered out and the rail is empty — the entry page becomes a
// navigation dead-end for the very viewer who was invited to browse it. `WikiScopedSubEntries` fixes
// it by re-fetching the context with the stored visitor token on mount and merging the scoped
// children in.
//
// This drives the REAL reader with a REAL invited session: a PUBLISHED parent (so the page renders
// for anyone) with a GATED child, a code whose role grants `wiki://**`, and we assert the gated child
// shows up as a link in the sub-entries rail. RED before the fix: SSR-anonymous → the gated child
// never appears.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'scoped-sub@example.com', password: 'correct-horse-battery-staple',
  handle: 'scopedsub', fullName: 'Scoped Sub Owner',
};
// Titles MUST equal their path segment: seedParentChain (building the child's parent) matches an
// existing parent by EXACT title, so a display-cased title would collide instead of reuse.
const PARENT = { title: 'cybernetics', path: 'cybernetics', body: 'The parent note.' };
const CHILD = { title: 'theory', path: 'cybernetics/theory', body: 'A gated child note.' };
const CODE = 'SUBSCOPE-1';

test.describe('F-L-13 · invited reader sees gated children in the sub-entries rail', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedTreeAndCode(request);
    await request.dispose();
  });

  test('a gated child renders as a link in the parent reader page for an invited viewer',
    async ({ page }) => {
      await enterCodeSession(page, CODE, 'Visitor');
      await goto(page, `/wiki/${PARENT.path}`);
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      const rail = page.getByTestId('wiki-subentries');
      await expect(rail).toBeVisible({ timeout: 5_000 });
      await expect(rail.getByRole('link', { name: new RegExp(CHILD.title, 'i') }))
        .toHaveAttribute('href', `/wiki/${CHILD.path}`, { timeout: 5_000 });
    });
});

async function seedTreeAndCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'scoped-sub-seed');
  const sid = await initMCP(request, apiToken);
  // PUBLISHED parent → the reader page renders for anyone (anonymous SSR finds it).
  const parent = await seedWiki(request, apiToken, sid, {
    body: PARENT.body, title: PARENT.title, path: PARENT.path,
  });
  await publishEntry(request, apiToken, sid, { genre: 'wiki', id: parent.wikiID });
  // GATED child (not published) → invisible to anonymous SSR, visible only via the token re-fetch.
  await seedWiki(request, apiToken, sid, {
    body: CHILD.body, title: CHILD.title, path: CHILD.path,
  });
  // A code whose role grants the whole wiki tree → the invited viewer is in scope for the child.
  const role = await createRole(request, csrf, {
    name: 'sub-scope', corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, { code: CODE, label: 'sub-scope', assumed_role_id: role.id });
}
