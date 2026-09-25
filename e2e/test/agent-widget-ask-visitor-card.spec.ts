// agent-widget-ask-visitor-card.spec.ts —— when the agent asks the visitor a question
// (ask_visitor, a return-directly tool), the embedded AgentWidget shows the card and the visitor can
// answer it — same as the main chat. Prod (2026-09-24, /p/lucerna, public tier): the model called
// ask_visitor, the widget rendered nothing (it had no card host), and the backend then treated the
// card turn as "no answer" and forced a tool-less synthesis on top of it (which Groq rejected with a
// 400). The visitor saw their question and then nothing, forever.
//
// Asserted, blackbox:
//   • the card renders inside the widget (sandboxed iframe from the tool's own ui:// html), with the
//     question and options the model sent;
//   • clicking an option sends it as the visitor's next message;
//   • the card turn ends as the card: the backend logs this turn's stop (the receipt that the turn
//     finished) with no forced synthesis in it.

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { backendLogTail, execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { openReader } from '@/fixtures/navigate';
import { publishPage } from '@/fixtures/microsite-rig';
import { createProvider } from '@/fixtures/providers';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'widgetask@example.com', password: 'correct-horse-battery-staple',
  handle: 'widgetask', fullName: 'Widget Ask Owner',
};
const SLUG = 'ask-card';
const APP = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><AgentWidget placeholder="Ask" /></main>;
}`;
const QUESTION = 'Do you mean available in France, or a French interface?';
const OPTIONS = ['Available in France', 'French interface', 'Both'];

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('AgentWidget · ask_visitor card', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(300_000); // one microsite build
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public',
    });
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    await publishPage(request, csrf, SLUG, APP);
    await request.dispose();
  });

  test('the card renders in the widget, answering it sends the choice, no forced synthesis',
    async ({ playwright }) => {
      test.setTimeout(120_000);
      const request = await playwright.request.newContext();
      const tag = await scriptMockToolCall(request, {
        name: 'ask_visitor', args: { question: QUESTION, kind: 'radio', options: OPTIONS },
      });
      const visitor = await (await playwright.chromium.launch()).newPage();
      await openReader(visitor, `/p/${SLUG}`);
      await expect(visitor.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });
      const logBefore = new Date().toISOString();

      await visitor.getByTestId('agent-widget-input').fill(`can I use it in French ${tag}`);
      await visitor.getByTestId('agent-widget-ask').click();

      const frame = await assertCard(visitor);
      // The turn is over (its stop line is logged) and it ended as the card — no forced synthesis.
      await expect.poll(() => turnLog(logBefore).includes('agent turn stop'), {
        timeout: 20_000, message: 'the card turn finished',
      }).toBe(true);
      expect(turnLog(logBefore), 'a card turn is not "no answer"').not.toContain('forcing synthesis');

      await frame.getByTestId('ask-visitor-opt-1').click();
      await expect(visitor.locator('[data-testid="agent-widget-transcript"] [data-role="visitor"]').last(),
        'the choice is sent as the visitor\'s next message').toContainText(OPTIONS[1], { timeout: 10_000 });

      await visitor.close();
      await request.dispose();
    });
});

async function assertCard(page: Page): Promise<FrameLocator> {
  await expect(page.getByTestId('agent-widget').getByTestId('mcp-app-card-ask_visitor'),
    'the widget renders the ask_visitor card').toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator('[data-testid="mcp-app-card-ask_visitor"]');
  await expect(frame.getByTestId('ask-visitor-question')).toHaveText(QUESTION, { timeout: 10_000 });
  for (let i = 0; i < OPTIONS.length; i++) {
    await expect(frame.getByTestId(`ask-visitor-opt-${i}`)).toHaveText(OPTIONS[i]);
  }
  return frame;
}

// turnLog —— backend log lines stamped at or after `since` (ISO time; the JSON lines carry "time").
function turnLog(since: string): string {
  return backendLogTail(4000).split('\n')
    .filter((l) => (/"time":"([^"]+)"/.exec(l)?.[1] ?? '') >= since)
    .join('\n');
}
