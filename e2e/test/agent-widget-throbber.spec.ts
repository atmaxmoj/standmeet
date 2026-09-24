// agent-widget-throbber.spec.ts —— the inline AgentWidget must show a real animated progress throbber
// while the agent works, like the main chat — not just swap the input placeholder to "thinking…".
//
// Blackbox: an anonymous visitor asks on a microsite AgentWidget (public provider wired). The turn is
// held with the mock's [[think:N]] marker (sleep N ms, then answer), so the throbber is on screen
// long enough to assert deterministically. We assert the throbber element is visible during the turn
// and gone once the answer lands.
//
// RED before the change: the widget renders no throbber element (only the placeholder text changes),
// so agent-widget-throbber never appears.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken, execSQL } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';
import { createProvider } from '@/fixtures/providers';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'throbber@example.com', password: 'correct-horse-battery-staple',
  handle: 'throbber', fullName: 'Throbber Owner',
};
const SLUG = 'ask-throb';
const ANSWER = 'Here is the considered answer.';
const APP = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><AgentWidget placeholder="Ask me anything" /></main>;
}`;

interface BuildPayload { build_id: string; status: string; error_message?: string }

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('AgentWidget · shows an animated progress throbber while the agent works', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public',
    });
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    const token = await createAPIToken(request, csrf, 'throbber-seed');
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

  test('a throbber shows while the turn is in flight and disappears once the answer lands',
    async ({ playwright }) => {
      test.setTimeout(120_000);
      const request = await playwright.request.newContext();
      const tag = await scriptMockReplyText(request, ANSWER);

      const reader = await (await playwright.chromium.launch()).newPage();
      await openReader(reader, `/p/${SLUG}`);
      await expect(reader.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });

      // [[think:3000]] holds the turn 3s before answering, so the throbber is reliably observable.
      await reader.getByTestId('agent-widget-input').fill(`tell me something ${tag} [[think:3000]]`);
      await reader.getByTestId('agent-widget-ask').click();

      const throbber = reader.getByTestId('agent-widget-throbber');
      await expect(throbber, 'an animated throbber shows while the agent works').toBeVisible({ timeout: 10_000 });

      // Once the answer streams in, the throbber gives way to the answer text.
      await expect(reader.getByTestId('agent-widget-transcript')).toContainText(ANSWER, { timeout: 30_000 });
      await expect(throbber, 'the throbber clears when the answer lands').toBeHidden();

      await reader.close();
      await request.dispose();
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
