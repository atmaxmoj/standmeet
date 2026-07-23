// wiki-reader-crosslink.spec.ts —— F-L-12: the public wiki reader must render `[[wikilink]]` as a
// real anchor, not literal `[[…]]` text. The backend rewrites `[[Title]]` → `[Title](/wiki/<path>)`
// against a title→path index; the bug was the index being **published-only**, so an all-gated
// instance (or any body linking a not-yet-published note) left every link as dead literal text.
//
// This drives the REAL reader page: two entries, one's body links the other by `[[Title]]`, and we
// assert the rendered body carries an `<a href="/wiki/…">` — not `[[…]]`.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'wiki-xlink@example.com', password: 'correct-horse-battery-staple',
  handle: 'wikixlink', fullName: 'Wiki Crosslink Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-L-12 · public wiki reader linkifies [[wikilinks]]', () => {
  test.beforeAll(async ({ playwright }) => {
    await seedLinkedPair(playwright);
  });

  test('a [[Title]] in the body renders as a /wiki/ anchor, not literal [[…]]',
    async ({ page }) => {
      await goto(page, '/wiki/hub');
      const body = page.getByTestId('wiki-body');
      await expect(body).toBeVisible({ timeout: 5_000 });
      // the wikilink resolved to an anchor pointing at the target entry
      const link = body.getByRole('link', { name: /Spoke/i });
      await expect(link).toHaveAttribute('href', '/wiki/spoke');
      // and no literal double-bracket text survives
      await expect(body).not.toContainText('[[');
    });
});

async function seedLinkedPair(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'xlink-seed');
  const sid = await initMCP(request, token);
  const spoke = await seedPublicWiki(request, token, sid, {
    body: 'A target note.', title: 'Spoke',
  });
  await publish(request, token, sid, spoke.wikiID);
  const hub = await seedPublicWiki(request, token, sid, {
    body: 'Areas: [[Spoke]] — the linked note.', title: 'Hub',
  });
  await publish(request, token, sid, hub.wikiID);
  await request.dispose();
}

async function publish(
  request: APIRequestContext, token: string, sid: string, wikiID: string,
): Promise<void> {
  await callTool(request, token, sid, 'seo.set_wiki_seo', {
    wiki_id: wikiID, excerpt: '', published: true,
  });
}
