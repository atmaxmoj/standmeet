// corpus-grid-virtual.spec.ts —— the admin grid view is VIRTUALIZED + PAGINATED: it loads
// one keyset page at a time (never the whole corpus) and windows the DOM (only visible rows
// rendered). Guards the other half of the owner's scale-safe ask ("the grid also needs a
// virtual list — no performance problems").
//   1. the first page loads (one /page request, no cursor); a page-2 row is neither fetched
//      nor in the DOM;
//   2. scrolling to the end fires a cursored /page request and the page-2 row appears;
//   3. the DOM stays windowed — far fewer row nodes than items loaded.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'grid-virtual@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'gridvirtual',
  fullName: 'Grid Virtual Owner',
};

// gridPageSize is 30 on the backend; seed a bit over one page so page 2 exists.
const SEED = 33;
let firstID = '';
let lastID = '';

test.describe.configure({ timeout: 180_000 });
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin corpus virtual grid', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'grid-virtual-seed');
    const sid = await initMCP(request, token);
    for (let i = 1; i <= SEED; i += 1) {
      const id = await promoteWiki(request, token, sid, `GridItem-${String(i).padStart(2, '0')}`);
      firstID = firstID || id; // oldest → page 2 (created_at DESC)
      lastID = id;             // newest → page 1
    }
    await request.dispose();
  });

  test('grid paginates on scroll and windows the DOM',
    async ({ adminPage }) => {
      const pageReqs: string[] = [];
      adminPage.on('request', (r) => {
        const u = r.url();
        if (u.includes('/corpus/wiki/page')) pageReqs.push(u);
      });

      await gotoAdminSection(adminPage, 'wiki');
      await adminPage.getByTestId('corpus-view-grid').click();

      // Page 1 loaded (newest); the oldest row is on page 2 — not fetched, not in the DOM.
      await expect(adminPage.getByTestId(`wiki-row-${lastID}`)).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByTestId(`wiki-row-${firstID}`)).toHaveCount(0);
      await expect.poll(() => pageReqs.filter((u) => !u.includes('cursor=')).length).toBe(1);
      expect(pageReqs.some((u) => u.includes('cursor='))).toBeFalsy();

      // Windowing: far fewer row nodes in the DOM than the 30 items loaded.
      const domRows = await adminPage.getByTestId(/^wiki-row-/).count();
      expect(domRows).toBeLessThan(30);

      // Scroll the grid container to the end → the next page loads (cursored request).
      await adminPage.getByTestId('wiki-list').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect.poll(() => pageReqs.some((u) => u.includes('cursor='))).toBeTruthy();
      await expect(adminPage.getByTestId(`wiki-row-${firstID}`)).toBeVisible({ timeout: 5_000 });
    });
});

async function promoteWiki(
  request: APIRequestContext, token: string, sid: string, title: string,
): Promise<string> {
  const raw = await callTool<{ id: string }>(
    request, token, sid, 'corpus.create',
    { genre: 'raw', body: `body of ${title}`, source: 'mcp:e2e', tags: [] },
  );
  const w = await callTool<{ id: string }>(
    request, token, sid, 'corpus.promote', { genre: 'raw', id: raw.id, title },
  );
  return w.id;
}
