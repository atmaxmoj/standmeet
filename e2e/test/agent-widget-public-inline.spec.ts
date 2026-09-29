// agent-widget-public-inline.spec.ts —— when the owner has wired a public LLM provider WITH usable
// quota, a codeless visitor asking in the AgentWidget gets an answer INLINE, not a /gate handoff.
// When the provider's quota is spent, the widget must not offer inline chat on it — that would just
// error every anonymous visitor. It offers the visitor's own key instead (owner decision 2026-09-25:
// out of quota → BYOK, not a dead-end redirect; agent-widget-byok.spec.ts drives that flow).
//
// Blackbox: a microsite whose content is <AgentWidget/>, the public role pointed at the mock gateway.
//   • quota available  → codeless visit renders data-mode="inline" and the answer streams in place.
//   • quota exhausted   → codeless visit renders data-mode="byok", not inline.
//
// RED before the change: the widget has no public-inline path — codeless is always data-mode="gate".

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken, execSQL } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';
import { createProvider } from '@/fixtures/providers';
import { scriptMockReplyText, resetGatewayRequests } from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'publicinline@example.com', password: 'correct-horse-battery-staple',
  handle: 'publicinline', fullName: 'Public Inline Owner',
};
const SLUG = 'ask-me';
const ANSWER = 'Answered inline from the public tier.';
const APP = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><AgentWidget placeholder="Ask me anything" /></main>;
}`;

interface BuildPayload { build_id: string; status: string; error_message?: string }

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('AgentWidget · codeless answers inline only when a public provider has quota', () => {
  let providerID = '';

  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    // One microsite build inside the hook: without this the hook keeps the default 30s timeout
    // and is killed before waitForBuild's own 180s budget matters (a ~40s build on a loaded host).
    test.setTimeout(300_000);
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
    // Publish the AgentWidget microsite via MCP so both tests share it.
    const token = await createAPIToken(request, csrf, 'public-inline-seed');
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'microsite.create', { slug: SLUG, title: SLUG });
    const written = await callTool<BuildPayload>(request, token, sid, 'microsite.write_file',
      { slug: SLUG, path: 'App.tsx', content: APP });
    const built = await waitForBuild(request, token, sid, written.build_id);
    await callTool(request, token, sid, 'microsite.promote_to_live', { slug: SLUG, build_id: built.build_id });
    await expect
      .poll(async () => (await request.get(`/api/v1/microsites/${SLUG}`)).status(), { timeout: 30_000 })
      .toBe(200);
    await request.dispose();
  });

  test('quota available → codeless ask answers inline, no /gate redirect',
    async ({ playwright, browser }) => {
      test.setTimeout(120_000);
      const request = await playwright.request.newContext();
      await resetGatewayRequests(request);
      const tag = await scriptMockReplyText(request, ANSWER);

      const reader = await (await browser.newContext()).newPage();
      await openReader(reader, `/p/${SLUG}`);
      const widget = reader.getByTestId('agent-widget');
      await expect(widget).toBeVisible({ timeout: 20_000 });
      await expect(widget, 'codeless + public provider with quota → inline').toHaveAttribute('data-mode', 'inline');

      const input = widget.getByTestId('chat-input-field');
      await input.fill(`what do you write about? ${tag}`);
      await input.press('Enter');
      await expect(widget.getByTestId('answer-body').last(), 'answer renders inline')
        .toContainText(ANSWER, { timeout: 30_000 });
      expect(reader.url(), 'stayed on the page — no gate redirect').toContain(`/p/${SLUG}`);

      await reader.context().close();
      await request.dispose();
    });

  test('no usable quota → codeless is offered its own key, not inline chat',
    async ({ browser }) => {
      test.setTimeout(60_000);
      // Exhaust the public provider's tank: a metered tank filled now with 0 budget → 0 remaining.
      execSQL(`UPDATE owner_providers SET gas_tokens=0, gas_filled_at=now() WHERE id='${providerID}'`);

      const reader = await (await browser.newContext()).newPage();
      await openReader(reader, `/p/${SLUG}`);
      const widget = reader.getByTestId('agent-widget');
      await expect(widget).toBeVisible({ timeout: 20_000 });
      await expect(widget, 'quota spent → the visitor brings a key, not inline chat on a dry tank')
        .toHaveAttribute('data-mode', 'byok');

      await reader.context().close();
    });
});

async function waitForBuild(
  request: APIRequestContext, token: string, sid: string, buildID: string,
): Promise<BuildPayload> {
  let last: BuildPayload = { build_id: buildID, status: 'pending' };
  await expect.poll(async () => {
    last = await callTool<BuildPayload>(request, token, sid, 'microsite.get_build', { build_id: buildID });
    if (last.status === 'failed') throw new Error(`build failed: ${last.error_message ?? '(no message)'}`);
    return last.status;
  }, { timeout: 180_000, intervals: [1000, 1000, 2000] }).toBe('built');
  return last;
}
