// openai-compat-visitor-can-converse.spec.ts —— the openai-compat provider family (deepseek /
// kimi / groq / together / openrouter / siliconflow / custom) shares ONE wire + ONE eino adapter,
// and had ZERO e2e coverage: the mock only spoke Anthropic and every e2e owner was seeded
// `anthropic`. Prod runs `deepseek`, so a bug living only on the openai-compat path was invisible
// to the whole suite.
//
// The bug: go-openai serializes an assistant message with `tool_calls` + empty content WITHOUT
// the `content` field (`json:"content,omitempty"`). OpenAI tolerates it; DeepSeek's deserializer
// returns 422 ("messages[i]: missing field `content`"). eiab wired JS block tools in, so the agent
// now tool-calls every turn and emits exactly that message.
//
// WHY THIS IS A MULTI-TURN TEST (black-box, no implementation-peeking): a SINGLE tool-calling turn
// hides the bug at the visitor level — the primary loop 422s, but the boundary rescue
// (forceFinalAnswer) re-synthesises from a CLEAN, tool-less message set and the visitor still gets
// an answer. The bug only reaches the visitor once a tool-calling assistant message is in the
// CONVERSATION HISTORY: on the NEXT turn both the primary loop AND the rescue carry that
// content-less message, both 422, and the visitor gets nothing — which is exactly what prod showed
// (`answer_chars:0 recovered:false`, every conversation `turns:0` after the eiab deploy). Real
// visitors converse across turns, so this is the faithful path. The assertion is purely on the
// rendered answer the visitor reads; swapping the product's internals changes nothing here.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  claim, createAPIToken, login as loginAPI,
  seedAIProvider, ANTHROPIC_MOCK_CFG, DEEPSEEK_MOCK_CFG,
} from '@/fixtures/admin';
import type { AIProviderCfg } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';

const NEEDLE = 'Zorptangle';

const CASES: { name: string; cfg: AIProviderCfg }[] = [
  // Anthropic is the control: proves the multi-turn tool-calling flow + harness work on a wire
  // family that was already covered. openai-compat (deepseek) is the one the bug lived on.
  { name: 'anthropic', cfg: ANTHROPIC_MOCK_CFG },
  { name: 'openai-compat (deepseek)', cfg: DEEPSEEK_MOCK_CFG },
];

for (const { name, cfg } of CASES) {
  test.describe(`coded visitor multi-turn tool-calling over ${name}`, () => {
    const owner = {
      email: `oai-${cfg.provider}@example.com`,
      password: 'correct-horse-battery-staple',
      handle: `owner${cfg.provider}`,
      fullName: 'Provider Owner',
    };
    const code = `CONV-${cfg.provider.toUpperCase()}1`;

    test.beforeAll(async ({ playwright }) => {
      await initOwner(playwright, owner, code, cfg);
    });

    test('two tool-calling turns in one conversation — the visitor gets an answer BOTH times',
      async ({ page }) => {
        test.setTimeout(90_000);
        await enterCodeSession(page, code, 'Recruiter Rhea');
        const input = page.getByTestId('chat-input-field');
        await expect(input, 'the coded visitor lands in a usable chat')
          .toBeEnabled({ timeout: 20_000 });

        // Turn 1 — a tool-calling turn. On buggy openai-compat code the primary loop 422s but the
        // clean rescue still answers, so turn 1 completes here too. Its purpose: leave a
        // tool-calling assistant message (empty content) in the conversation history.
        await sendToolCallingTurn(page, input, 'tell me what they are about',
          'Turn one — grounded in the corpus.');

        // Turn 2 — the same shape, now with turn 1 in history. On buggy openai-compat code both the
        // primary AND the rescue carry the history's content-less assistant message → both 422 →
        // the visitor gets NO answer (RED). Fixed code sends `content` on every message → the
        // primary loop completes → the visitor gets the answer (GREEN). Pure visitor-visible signal.
        await sendToolCallingTurn(page, input, 'and what have they built recently',
          'Turn two — still grounded, still in their voice.');
      });
  });
}

// sendToolCallingTurn —— drives one visitor turn that forces a real tool-call loop (corpus_search
// on the seeded NEEDLE note), then asserts the AI's answer for THIS turn rendered for the visitor.
async function sendToolCallingTurn(
  page: Page, input: ReturnType<Page['getByTestId']>, ask: string, reply: string,
): Promise<void> {
  const searchTag = await scriptMockToolCall(page.request, {
    name: 'corpus_search', args: { query: NEEDLE },
  });
  const replyTag = await scriptMockReplyText(page.request, reply);
  const turnDone = page.waitForResponse(
    (r) => r.url().includes('/agent/turn') && r.status() === 200, { timeout: 45_000 });
  await input.fill(`${ask}${searchTag}${replyTag}`);
  await input.press('Enter');
  await (await turnDone).finished();
  await expect(page.getByTestId('answer-body').last(),
    'the visitor reads the AI answer for this turn').toContainText(reply, { timeout: 25_000 });
}

async function initOwner(
  playwright: Playwright,
  owner: { email: string; password: string; handle: string; fullName: string },
  code: string,
  cfg: AIProviderCfg,
): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: owner.email, password: owner.password, handle: owner.handle, fullName: owner.fullName,
  });
  await seedAIProvider(request, { email: owner.email, password: owner.password }, cfg);
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const token = await createAPIToken(request, csrf, 'oai-seed');
  const sid = await initMCP(request, token);
  await seedPublicWiki(request, token, sid, {
    body: `${NEEDLE} marks this note: they build reliable systems.`, title: `${NEEDLE} Dossier`,
  });
  await createCode(request, csrf, {
    code, label: 'Recruiter link', max_turns_per_session: 50, max_members: 10,
  });
  await request.dispose();
}
