// agent-widget-persist.spec.ts —— the inline AgentWidget conversation persists on the client, at
// page granularity. A visitor who asks, then reloads, still sees the transcript AND the model still
// remembers (the restored transcript is seeded back as history for the next turn). A DIFFERENT page
// keeps its own conversation (no cross-page bleed).
//
// Blackbox: public provider wired; a microsite whose content is <AgentWidget/>. Ask Q1 → answer A1,
// reload, assert A1 still shown; then ask Q2 and assert the gateway request for that turn carried A1
// (history restored → memory survived the reload). Then a second page's widget starts empty.
//
// RED before the change: useChatSession keeps messages only in React state and sends no restored
// history, so after reload the transcript is empty and the next turn carries no prior context.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken, execSQL, querySQL } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';
import { createProvider } from '@/fixtures/providers';
import { scriptMockReplyText, lastGatewayRequest, resetGatewayRequests } from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'chatpersist@example.com', password: 'correct-horse-battery-staple',
  handle: 'chatpersist', fullName: 'Chat Persist Owner',
};
const SLUG = 'ask-persist';
const SLUG2 = 'ask-other';
const A1 = 'ORANGE_MARKER_first_answer_z9';
const A2 = 'the second answer';
const APP = (slug: string) => `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite" data-page="${slug}"><AgentWidget placeholder="Ask" /></main>;
}`;

interface BuildPayload { build_id: string; status: string; error_message?: string }

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('AgentWidget · conversation persists in localStorage at page granularity', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(420_000); // two microsite builds
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public',
    });
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    const token = await createAPIToken(request, csrf, 'persist-seed');
    const sid = await initMCP(request, token);
    await publishWidget(request, token, sid, SLUG);
    await publishWidget(request, token, sid, SLUG2);
    await request.dispose();
  });

  test('reload keeps the transcript and the model still remembers; a second page is independent',
    async ({ playwright }) => {
      test.setTimeout(120_000);
      const request = await playwright.request.newContext();
      await resetGatewayRequests(request);

      const reader = await (await playwright.chromium.launch()).newPage();
      await openReader(reader, `/p/${SLUG}`);
      await expect(reader.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });

      // Turn 1
      const tag1 = await scriptMockReplyText(request, A1);
      await reader.getByTestId('agent-widget-input').fill(`first question ${tag1}`);
      await reader.getByTestId('agent-widget-ask').click();
      await expect(reader.getByTestId('agent-widget-transcript')).toContainText(A1, { timeout: 30_000 });

      // Reload — the transcript must come back from localStorage.
      await reader.reload();
      await expect(reader.getByTestId('agent-widget-transcript'),
        'the conversation survives a reload').toContainText(A1, { timeout: 20_000 });

      // Turn 2 after reload — the request must carry A1 as history (memory restored).
      const tag2 = await scriptMockReplyText(request, A2);
      await reader.getByTestId('agent-widget-input').fill(`second question ${tag2}`);
      await reader.getByTestId('agent-widget-ask').click();
      await expect(reader.getByTestId('agent-widget-transcript')).toContainText(A2, { timeout: 30_000 });
      const rec = await lastGatewayRequest(request, tag2, A1);
      expect(rec.found, 'the second turn hit the gateway').toBe(true);
      expect(rec.contains, 'the second turn carried the pre-reload answer as history').toBe(true);

      // The visitor can clear the conversation; it stays cleared across a reload.
      await reader.getByTestId('agent-widget-clear').click();
      await expect(reader.getByTestId('agent-widget-transcript'), 'clear wipes the transcript')
        .not.toContainText(A1);
      await reader.reload();
      await expect(reader.getByTestId('agent-widget'), 'widget re-renders after the clearing reload')
        .toBeVisible({ timeout: 20_000 });
      await expect(reader.getByTestId('agent-widget-transcript'), 'the cleared chat does not come back')
        .not.toContainText(A1);
      // The visitor's reset is client-only: the owner's server-side record of that turn stays.
      expect(Number(querySQL(`SELECT count(*) FROM messages WHERE body LIKE '%${A1}%'`)),
        'resetting the widget does not delete the server-side conversation').toBeGreaterThan(0);

      // A different page has its own (empty) conversation — no cross-page bleed.
      const other = await (await playwright.chromium.launch()).newPage();
      await openReader(other, `/p/${SLUG2}`);
      await expect(other.getByTestId('agent-widget')).toBeVisible({ timeout: 20_000 });
      await expect(other.getByTestId('agent-widget-transcript'), 'a different page starts fresh')
        .not.toContainText(A1);

      await reader.close();
      await other.close();
      await request.dispose();
    });
});

async function publishWidget(
  request: APIRequestContext, token: string, sid: string, slug: string,
): Promise<void> {
  await callTool(request, token, sid, 'microsite.create', { slug, title: slug });
  const written = await callTool<BuildPayload>(request, token, sid, 'microsite.write_file',
    { slug, path: 'App.tsx', content: APP(slug) });
  const built = await waitForBuild(request, token, sid, written.build_id);
  await callTool(request, token, sid, 'microsite.promote_to_live', { slug, build_id: built.build_id });
  await expect
    .poll(async () => (await request.get(`/api/v1/microsites/${slug}`)).status(), { timeout: 30_000 })
    .toBe(200);
}

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
