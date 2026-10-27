// wiki-public-chat.spec.ts —— a codeless reader on a /wiki entry chats on the owner's PUBLIC tier
// right there in the reader, instead of being walled behind "bring your own key". This is the reader
// half of the public-tier reversal (the microsite half is agent-widget-public-inline.spec.ts): the
// owner, 2026-10-26, "我们现在有公版ai，所以这边应该能直接聊了吧，聊到了限额才会换成这样吧".
//
// Blackbox: a published wiki entry; the `public` role pointed at the mock gateway.
//   • quota available → a codeless visit renders the chat inline in the right rail and the answer
//     streams in place, with no /gate redirect.
//   • quota spent     → the rail offers the visitor's own key, not inline chat on a dry tank.
//
// RED before the change: the reader's right rail was a BYOAI key-wall for a codeless visitor — no
// public-inline path at all, so the first assertion (data-mode="inline") could never hold.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken, execSQL } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';
import { createProvider } from '@/fixtures/providers';
import { scriptMockReplyText, resetGatewayRequests } from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'wikipublic@example.com', password: 'correct-horse-battery-staple',
  handle: 'wikipublic', fullName: 'Wiki Public Owner',
};
const ANSWER = 'Answered inline from the public tier, in the reader.';
// Wide enough that the reader renders the right rail (inline chat), not the floating dock
// (ReaderChat.tsx switches at 1700).
const WIDE = { width: 1800, height: 1000 };

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('wiki reader · a codeless visitor chats on the public tier inline', () => {
  let providerID = '';
  let slug = '';

  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(120_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // Wire a public provider (unmetered → quota available) and point the `public` role at it.
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public',
    });
    providerID = pub.id;
    execSQL(`UPDATE roles SET provider_id='${providerID}' WHERE name='public'`);
    // A published wiki entry the codeless reader can land on and ask about.
    const token = await createAPIToken(request, csrf, 'wiki-public-seed');
    const sid = await initMCP(request, token);
    const { wikiID } = await seedPublicWiki(request, token, sid, {
      body: 'Grice\'s maxims describe cooperative conversation.', title: 'Grice Maxims',
    });
    await publishEntry(request, token, sid, { genre: 'wiki', id: wikiID, excerpt: 'cooperation.' });
    slug = await discoverRootPath(request, wikiID);
    await request.dispose();
  });

  test('quota available → codeless ask answers inline in the rail, no /gate redirect',
    async ({ playwright, browser }) => {
      test.setTimeout(90_000);
      const request = await playwright.request.newContext();
      await resetGatewayRequests(request);
      const tag = await scriptMockReplyText(request, ANSWER);

      const reader = await (await browser.newContext({ viewport: WIDE })).newPage();
      await openReader(reader, `/wiki/${slug}`);
      await expect(reader.getByTestId('wiki-landing')).toBeVisible({ timeout: 10_000 });
      const rail = reader.getByTestId('reader-chat-rail');
      await expect(rail, 'the right rail renders a chat, not a key-wall').toBeVisible({ timeout: 10_000 });
      const widget = rail.getByTestId('agent-widget');
      await expect(widget, 'codeless + public provider with quota → inline, not byok/gate')
        .toHaveAttribute('data-mode', 'inline', { timeout: 10_000 });

      const input = widget.getByTestId('chat-input-field');
      await input.fill(`what is this about? ${tag}`);
      await input.press('Enter');
      await expect(widget.getByTestId('answer-body').last(), 'answer renders inline in the rail')
        .toContainText(ANSWER, { timeout: 30_000 });
      expect(reader.url(), 'stayed on the wiki page — no gate redirect').toContain(`/wiki/${slug}`);

      // Choosing your own key VOLUNTARILY (the tier still has quota) must not claim it ran out —
      // owner caught the copy lying: "但是这次是我自己点的". The panel shows the neutral invitation.
      await rail.getByTestId('agent-widget-byok-offer').click();
      const byok = rail.getByTestId('agent-widget-byok');
      await expect(byok).toBeVisible({ timeout: 5_000 });
      await expect(byok, 'voluntary → not the "quota used up" copy').not.toContainText(/used up/i);
      await expect(byok, 'voluntary → the neutral invitation').toContainText(/prefer your own/i);

      await reader.context().close();
      await request.dispose();
    });

  test('no usable quota → the rail offers the visitor’s own key, not inline chat',
    async ({ browser }) => {
      test.setTimeout(60_000);
      // Exhaust the public provider's tank: a metered tank filled now with 0 budget → 0 remaining.
      execSQL(`UPDATE owner_providers SET gas_tokens=0, gas_filled_at=now() WHERE id='${providerID}'`);

      const reader = await (await browser.newContext({ viewport: WIDE })).newPage();
      await openReader(reader, `/wiki/${slug}`);
      await expect(reader.getByTestId('wiki-landing')).toBeVisible({ timeout: 10_000 });
      const widget = reader.getByTestId('reader-chat-rail').getByTestId('agent-widget');
      await expect(widget, 'quota spent → the visitor brings a key, not inline chat on a dry tank')
        .toHaveAttribute('data-mode', 'byok', { timeout: 10_000 });
      // Here the tier really IS out, so the panel's "free quota used up" copy is the honest one.
      await expect(widget.getByTestId('agent-widget-byok'), 'genuinely spent → the used-up copy')
        .toContainText(/used up/i, { timeout: 5_000 });

      await reader.context().close();
    });
});

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// discoverRootPath —— the entry's tree-derived path (by id) from the public wiki-tree root level.
async function discoverRootPath(request: APIRequestContext, wikiID: string): Promise<string> {
  const res = await request.get(`${BACKEND}/api/v1/wiki-tree`);
  const body = await res.json() as { nodes: Array<{ id: string; path: string }> };
  return body.nodes.find((n) => n.id === wikiID)?.path ?? '';
}
