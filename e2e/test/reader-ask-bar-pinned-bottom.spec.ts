// reader-ask-bar-pinned-bottom.spec.ts —— the reader's ask input is ALWAYS at the bottom, like a
// normal chat input (owner: "提问栏应该永远在下面 fix 住"), in every state and from SSR — not only once JS
// resolves. The bug: the layout was chosen by a client-side matchMedia (useWideScreen), so the
// server always rendered the dock branch with the not-yet-resolved gate bar ("Ask anything…") inline
// at the TOP of the page; a no-JS / slow-hydration reader saw it stuck there. The fix positions the
// one chat box by CSS media queries, honored at SSR, so the bar is at the bottom from the first paint.
//
// RED before the fix: with JavaScript disabled the gate bar rendered near the top (top ≈ 50–70px).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken, execSQL } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';
import { createProvider } from '@/fixtures/providers';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'askbar@example.com', password: 'correct-horse-battery-staple',
  handle: 'askbar', fullName: 'Ask Bar Owner',
};
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const NARROW = { width: 460, height: 920 };
const WIDE = { width: 1800, height: 1000 };

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('reader ask bar is pinned to the bottom, from SSR', () => {
  let slug = '';

  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(120_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public',
    });
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    const token = await createAPIToken(request, csrf, 'askbar-seed');
    const sid = await initMCP(request, token);
    const { wikiID } = await seedPublicWiki(request, token, sid, {
      body: 'Grice\'s maxims describe cooperative conversation.', title: 'Grice Maxims',
    });
    await publishEntry(request, token, sid, { genre: 'wiki', id: wikiID, excerpt: 'cooperation.' });
    slug = await rootPath(request, wikiID);
    await request.dispose();
  });

  // The owner's exact view: JavaScript disabled → the SSR render. The gate bar ("Ask anything…")
  // must be at the bottom, not the top, at both widths (SSR-correct, no JS to switch the layout).
  for (const [name, vp] of [['narrow', NARROW], ['wide', WIDE]] as const) {
    test(`no-JS gate bar sits at the bottom (${name})`, async ({ browser }) => {
      test.setTimeout(45_000);
      const ctx = await browser.newContext({ viewport: vp, javaScriptEnabled: false });
      const page = await ctx.newPage();
      await openReader(page, `/wiki/${slug}`);
      const bar = page.locator('.smc-handoff');
      await expect(bar, 'the unresolved gate bar renders').toBeVisible();
      const box = await bar.boundingBox();
      expect(box, 'gate bar has a box').not.toBeNull();
      // Pinned to the bottom: its bottom edge is within ~100px of the viewport bottom, and it sits
      // in the lower half — the opposite of the bug (top ≈ 50–70px).
      expect(box!.y, `gate bar in the lower half (${name})`).toBeGreaterThan(vp.height * 0.55);
      expect(box!.y + box!.height, `gate bar bottom near the viewport bottom (${name})`)
        .toBeGreaterThan(vp.height - 100);
      await ctx.close();
    });
  }

  // No regression once JS resolves: the live composer input is at the bottom too.
  test('resolved composer input sits at the bottom (narrow)', async ({ browser }) => {
    test.setTimeout(45_000);
    const page = await (await browser.newContext({ viewport: NARROW })).newPage();
    await openReader(page, `/wiki/${slug}`);
    const input = page.getByTestId('reader-chat').getByTestId('chat-input-field');
    await expect(input).toBeVisible({ timeout: 10_000 });
    const box = await input.boundingBox();
    expect(box!.y + box!.height, 'composer input near the viewport bottom')
      .toBeGreaterThan(NARROW.height - 140);
    await page.context().close();
  });
});

async function rootPath(request: APIRequestContext, wikiID: string): Promise<string> {
  const res = await request.get(`${BACKEND}/api/v1/wiki-tree`);
  const body = await res.json() as { nodes: Array<{ id: string; path: string }> };
  return body.nodes.find((n) => n.id === wikiID)?.path ?? '';
}
