// agent-widget-persist-resplit.spec.ts —— what the widget shows as an answer: a thread stored by an
// older SDK reads back whole, and narration before a tool call is not part of the answer.
//
// Before v0.1.100 the chat split an answer into paragraphs on every blank line, even one inside a
// fenced block: a mermaid diagram with a blank line between two subgraphs was stored as two
// paragraphs, and only its first half drew. v0.1.100 fixed the split for new answers, but a thread
// already kept in the visitor's browser still holds the old cut. Loading it must re-split the stored
// answer with today's rule, so the diagram draws whole.
//
// Blackbox: a microsite with <AgentWidget/>; the old-format thread is put into localStorage before
// the page loads (what an older SDK wrote), then the page must draw both subgraphs in one diagram.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken, execSQL } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';
import { createProvider } from '@/fixtures/providers';
import { scriptMockReplyText, scriptMockToolCall } from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'chatresplit@example.com', password: 'correct-horse-battery-staple',
  handle: 'chatresplit', fullName: 'Chat Resplit Owner',
};
const SLUG = 'ask-resplit';
const APP = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><AgentWidget placeholder="Ask" /></main>;
}`;

// The old cut: one mermaid fence stored as two paragraphs at its inner blank line.
const OLD_THREAD = [{
  id: 'd1', q: 'draw the two halves', time: '09:00', pending: false, currentTool: null,
  retrying: false, failed: false,
  answer: {
    citations: [], toolCalls: [],
    paras: [
      'Here is the diagram.',
      '```mermaid\ngraph TD\n  subgraph Alpha\n    a1[first]\n  end',
      '  subgraph Beta\n    b1[second]\n  end\n```',
    ],
  },
}];

interface BuildPayload { build_id: string; status: string; error_message?: string }

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('AgentWidget · a thread stored by an older SDK is re-split on load', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(300_000); // one microsite build
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public',
    });
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    const token = await createAPIToken(request, csrf, 'resplit-seed');
    await publishWidget(request, token, await initMCP(request, token));
    await request.dispose();
  });

  // Mock interview 2026-09-28 (red ③): the model said "Let me check my notes…", called a tool, then
  // answered — and the page showed both glued together. Text streamed before a tool call is the
  // model narrating its plan; the answer is what comes after.
  test('text the model streams before a tool call is not part of the answer', async ({ browser, playwright }) => {
    test.setTimeout(90_000);
    const request = await playwright.request.newContext();
    const tool = await scriptMockToolCall(request, { name: 'corpus_search', args: { query: 'notes' } },
      { narration: 'Let me check my notes NARRATION_Q7.' });
    const reply = await scriptMockReplyText(request, 'The answer is FINAL_Q7.');
    const reader = await (await browser.newContext()).newPage();
    await openReader(reader, `/p/${SLUG}`);
    const widget = reader.getByTestId('agent-widget');
    await expect(widget).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });
    const input = widget.getByTestId('chat-input-field');
    await input.fill(`what do your notes say?${tool}${reply}`);
    await input.press('Enter');
    const answer = widget.getByTestId('answer-body').last();
    await expect(answer, 'the answer arrived').toContainText('FINAL_Q7', { timeout: 30_000 });
    await expect(answer, 'without the narration before the tool call').not.toContainText('NARRATION_Q7');
    await reader.context().close();
    await request.dispose();
  });

  test('a mermaid diagram cut in two by the old split draws whole', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext();
    await ctx.addInitScript(([key, value]) => {
      localStorage.setItem(key, value);
    }, [`sm-chat-dialogs:agent:/p/${SLUG}`, JSON.stringify(OLD_THREAD)] as const);
    const reader = await ctx.newPage();
    await openReader(reader, `/p/${SLUG}`);

    const answer = reader.getByTestId('agent-widget').getByTestId('answer-body').first();
    await expect(answer, 'the stored thread is shown').toContainText('Here is the diagram', { timeout: 20_000 });
    const diagram = answer.getByTestId('mermaid-svg').locator('svg').first();
    await expect(diagram, 'one diagram holds the first subgraph').toContainText('Alpha', { timeout: 20_000 });
    await expect(diagram, 'and the second — the fence was not cut').toContainText('Beta');
    await ctx.close();
  });
});

async function publishWidget(request: APIRequestContext, token: string, sid: string): Promise<void> {
  await callTool(request, token, sid, 'microsite.create', { slug: SLUG, title: SLUG });
  const written = await callTool<BuildPayload>(request, token, sid, 'microsite.write_file',
    { slug: SLUG, path: 'App.tsx', content: APP });
  let last: BuildPayload = { build_id: written.build_id, status: 'pending' };
  await expect.poll(async () => {
    last = await callTool<BuildPayload>(request, token, sid, 'microsite.get_build', { build_id: written.build_id });
    if (last.status === 'failed') throw new Error(`build failed: ${last.error_message ?? '(no message)'}`);
    return last.status;
  }, { timeout: 180_000, intervals: [1000, 1000, 2000] }).toBe('built');
  await callTool(request, token, sid, 'microsite.promote_to_live', { slug: SLUG, build_id: last.build_id });
  await expect
    .poll(async () => (await request.get(`/api/v1/microsites/${SLUG}`)).status(), { timeout: 30_000 })
    .toBe(200);
}
