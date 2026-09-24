// reasoning-content-stripped.spec.ts —— the backend must NOT echo a model's reasoning_content back
// on the wire. Reasoning models (Groq gpt-oss-*) return reasoning_content; sending it back on a
// later turn makes strict OpenAI-compatible endpoints reject the request
// (`400 property 'reasoning_content' is unsupported`). Verified live via `make eval-ask`.
//
// Faithful blackbox: the mock EMITS reasoning_content on the scripted tool-call (opt-in), so it
// rides in the history; then we read the mock recorder to check whether the POST-TOOL request the
// backend actually sent carried reasoning_content. We assert it did NOT. RED while
// stripReasoningContent is a no-op (the backend echoes it); green once it strips.
//
// NOTE: this only proves anything if it goes RED on the unstripped backend — i.e. eino really
// parsed the mock's reasoning delta onto the assistant message and the backend echoed it. That red
// is observed with `make test-asis` before the strip lands (do not trust the green otherwise).

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI, createAPIToken, seedAIProvider, DEEPSEEK_MOCK_CFG } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';
import { runVisitorChatTurn } from '@/fixtures/visitor-chat-loop';
import { scriptMockToolCall, scriptMockReplyText, lastGatewayRequest, resetGatewayRequests } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'reasoning-strip@example.com', password: 'correct-horse-battery-staple',
  handle: 'reasoningstrip', fullName: 'Reasoning Strip Owner',
};
const NEEDLE = 'quantum widgets';
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('inference · reasoning_content is stripped from outbound requests', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    // openai-compat provider (reasoning_content lives on the openai wire, not the anthropic one).
    await seedAIProvider(request, { email: OWNER.email, password: OWNER.password }, DEEPSEEK_MOCK_CFG);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'reasoning-seed');
    const sid = await initMCP(request, token);
    const note = await seedWiki(request, token, sid, { title: 'Quantum Widgets', path: 'topic/quantum-widgets', body: `Notes on ${NEEDLE}.` });
    await publishEntry(request, token, sid, { genre: 'wiki', id: note.wikiID, excerpt: `About ${NEEDLE}.` });
    await request.dispose();
  });

  test('a multi-step turn does not echo reasoning_content back to the provider', async ({ playwright }) => {
    test.setTimeout(90_000);
    const request = await playwright.request.newContext();
    await resetGatewayRequests(request);

    const sess = await issueSession(request, { handle: OWNER.handle, mode: 'public', visitor_name: 'V' });
    // Turn 1 returns a tool call whose assistant message carries reasoning_content; turn 2 (post-tool)
    // is where the backend would echo it back.
    const toolTag = await scriptMockToolCall(request, { name: 'corpus_search', args: { query: NEEDLE } },
      { reasoning: 'The user asked about quantum widgets; let me search the corpus and synthesize.' });
    const replyTag = await scriptMockReplyText(request, `Here is what I found about ${NEEDLE}.`);

    // Drives the multi-step turn (tool call → tool → reply) through the real agent loop; throws on
    // an error frame, so reaching the assertion means the turn completed.
    await runVisitorChatTurn(request, sess, `Tell me about ${NEEDLE} ${toolTag}${replyTag}`);

    // The post-tool request (most recent under the tool tag) must NOT carry reasoning_content.
    const rec = await lastGatewayRequest(request, toolTag, '__HAS_REASONING__');
    expect(rec.found, 'the post-tool request was recorded').toBe(true);
    expect(rec.contains, 'backend must strip reasoning_content before sending upstream').toBe(false);
    await request.dispose();
  });
});
