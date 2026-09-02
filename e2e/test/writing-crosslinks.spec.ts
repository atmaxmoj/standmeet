// writing-crosslinks.spec.ts -- e2e for `[[X]]` bidirectional links inside writing body_md.
//
// Business story:
//   1. The owner has the AI call writing_create in Claude Desktop to write two writings: A and B.
//      A's body contains `[[B-slug]]`, `[[B Title]]`, `[[Bad Title|see B]]`.
//   2. A visitor opens /writings/A -> all three of those render as clickable
//      <a href="/writings/B"> links (slug match, title match, alias); the nonexistent
//      `[[Ghost]]` degrades to plain text `Ghost` -- the name stays, the brackets don't
//      make it past this layer (F-L-25).
//   3. A visitor opens /writings/B -> "linked from" backlinks appear in the footer, listing A.
//   4. A's body is edited to remove the `[[B-slug]]` segment -> /writings/B's backlinks disappear.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'crosslink-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'crosslinker',
  fullName: 'Cross Linker',
};

test.describe('writing crosslinks: [[X]] resolves + backlinks', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('A renders [[B]] as links + B shows backlink + unresolved degrades to plain text',
    async ({ request, page }) => {
      const { token: tok, sid } = await mcpSession(request, 'crosslink-token');

      // writing B first -- A needs B to already exist for the destination to resolve.
      await callTool(request, tok, sid, 'writing_create', {
        slug: 'writing-b',
        title: 'Writing B Heading',
        excerpt: 'Target of crosslinks.',
        body_md: 'Body of B.',
        cover_headline: 'b.', cover_hue: 'amber',
        tags: ['crosslink'], publish: true,
      });

      // writing A contains three [[X]]: slug match / title match / alias; plus one that doesn't exist.
      const A_BODY = [
        'Intro line.',
        '',
        'See [[writing-b]] for slug match.',
        '',
        'Also see [[Writing B Heading]] for title match.',
        '',
        'Or click [[writing-b|see B over there]] for alias.',
        '',
        'But [[ghost-writing]] stays literal.',
      ].join('\n');
      await callTool(request, tok, sid, 'writing_create', {
        slug: 'writing-a',
        title: 'Writing A',
        excerpt: 'Has crosslinks.',
        body_md: A_BODY,
        cover_headline: 'a.', cover_hue: 'violet',
        tags: ['crosslink'], publish: true,
      });

      // Visit A -> all three links render as anchors to /writings/writing-b; the ghost stays literal.
      await goto(page, '/writings/writing-a');
      const body = page.getByTestId('writing-article-body');
      const linkSlug = body.locator('a[href="/writings/writing-b"]', { hasText: 'Writing B Heading' });
      await expect(linkSlug).toHaveCount(2); // slug match + title match both render dst.title
      const linkAlias = body.locator('a[href="/writings/writing-b"]', { hasText: 'see B over there' });
      await expect(linkAlias).toHaveCount(1);
      // F-L-25 -- an unresolved link degrades to **plain text**, not the raw markup left in
      // place. This line used to assert `[[ghost-writing]]` appears verbatim; that assertion
      // just restated the implementation of the time without writing down any reason. But a
      // visitor is not an Obsidian user: the brackets are authoring mechanics, not content.
      // The name stays (the owner did write it), the brackets don't make it past this layer.
      // Both readers share usecase/crosslink.go's unresolvedCrossLinkText.
      const bodyText = (await body.innerText()).trim();
      expect(bodyText, '目标名留着 —— owner 写下的字不该被吞掉').toContain('ghost-writing');
      expect(bodyText, '访客看不到 Obsidian 链接语法').not.toContain('[[');
      // Verify A does not appear in its own backlinks (self-link excluded: A doesn't point to A)
      await expect(page.getByTestId('writing-article-backlinks')).toHaveCount(0);

      // Visit B -> A is in the backlinks
      await goto(page, '/writings/writing-b');
      const backlinks = page.getByTestId('writing-article-backlinks');
      await expect(backlinks).toBeVisible();
      const aLi = page.getByTestId('backlink-writing-a');
      await expect(aLi).toHaveText('Writing A');
      // Click the <a> itself (the testid is on the <li>; clicking the <li> won't trigger link navigation).
      await backlinks.getByRole('link', { name: 'Writing A' }).click();
      await page.waitForURL('**/writings/writing-a');
    });

  test('delete A → B backlinks cleared (FK cascade)',
    async ({ request, page }) => {
      const { token: tok, sid } = await mcpSession(request, 'delete-crosslink-token');
      // Get writing-a's id: straight from writings.list.
      const rows = await callTool<{ id: string; slug: string }[]>(
        request, tok, sid, 'writings.list', {},
      );
      const aRow = rows.find((p) => p.slug === 'writing-a');
      expect(aRow).toBeTruthy();
      await callTool(request, tok, sid, 'writings.delete', { writing_id: aRow!.id });

      await goto(page, '/writings/writing-b');
      // The backlinks section disappears; at minimum it no longer contains writing-a.
      await expect(page.getByTestId('backlink-writing-a')).toHaveCount(0);
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function mcpSession(
  request: APIRequestContext, tokenName: string,
): Promise<{ token: string; sid: string }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, tokenName);
  const sid = await initMCP(request, apiToken);
  return { token: apiToken, sid };
}
