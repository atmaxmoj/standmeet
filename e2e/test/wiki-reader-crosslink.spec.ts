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
import { publishEntry, seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
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

  // F-L-25 —— a link the reader CANNOT resolve must degrade to plain text, never to markup.
  //
  // Found on prod against the real vault: `recursive-harness` links `[[recursion-is-a-phase-transition]]`,
  // that note exists, and the reader printed the brackets. Two neighbouring links in the same
  // bullet list rendered as anchors, so the resolver was not broken — the target is genre `raw`,
  // and the index the rewriter gets (owner/usecase/seo.go:161, built from Wiki.ListAllMeta) holds
  // wiki only. applyOneWikiRewrite returns the body untouched on a miss, brackets and all.
  //
  // **What this case covers and what it does not.** It seeds a DANGLING target, not a raw one,
  // because a raw note carries no title through `corpus.create` (ops/corpus.go:87 — "raw has no
  // title") and titled raw notes only exist via vault import. Both cases enter the same branch
  // (`!ok` → return body), so this pins the behaviour; it does not prove the raw-genre path.
  // Whoever adds the import-driven fixture should assert the raw case here too.
  //
  // The assertion reads the text out before judging: `.not.toContainText` also passes while the
  // element is still absent ([[negated-assertion-passes-while-absent]]), and the whole point is a
  // claim about what the visitor sees.
  test('a [[link]] the reader cannot resolve degrades to plain text, not to markup',
    async ({ page }) => {
      await goto(page, '/wiki/hub');
      const body = page.getByTestId('wiki-body');
      await expect(body).toBeVisible({ timeout: 5_000 });
      const text = (await body.innerText()).trim();
      expect(text, 'the reader rendered a body at all (positive control)').toContain('Areas:');
      expect(text, 'the unresolved target survives as readable words').toContain('Nowhere Note');
      expect(text, 'no Obsidian link syntax reaches the visitor').not.toContain('[[');
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
    // one link that resolves, one that cannot — the pair is what makes the two cases comparable.
    body: 'Areas: [[Spoke]] — the linked note. Also [[Nowhere Note]], which no entry answers to.',
    title: 'Hub',
  });
  await publish(request, token, sid, hub.wikiID);
  await request.dispose();
}

async function publish(
  request: APIRequestContext, token: string, sid: string, wikiID: string,
): Promise<void> {
  await publishEntry(request, token, sid, { genre: 'wiki', id: wikiID });
}
