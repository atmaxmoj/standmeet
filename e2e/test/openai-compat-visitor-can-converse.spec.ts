// openai-compat-visitor-can-converse.spec.ts —— the openai-compat provider family (deepseek /
// kimi / groq / together / openrouter / siliconflow / custom) shares ONE wire + ONE eino adapter,
// and had ZERO e2e coverage: the mock only spoke Anthropic and every e2e owner was seeded
// `anthropic`. Prod runs `deepseek`, so this whole path — adapter construction, the
// /v1/chat/completions wire, tool-call round-trips — was never exercised end to end.
//
// This spec closes that gap: a coded visitor holds a two-turn tool-calling conversation over both
// anthropic (the already-covered control) and openai-compat (deepseek). It asserts the visitor
// reads a real answer each turn, so gross breakage on the openai-compat path — a wire-format
// mismatch, a failed adapter build, a turn that 500s — surfaces here instead of only in prod.
//
// The mock is faithful to DeepSeek's strict deserializer: it 422s any message missing the
// `content` field (openai.go). That matters because go-openai serializes with `content,omitempty`
// (chat.go:119), so an assistant message with tool_calls + empty content goes out WITHOUT the
// field; OpenAI tolerates it, DeepSeek rejects it. The backend's content-guard (eino_model.go)
// fills empty content so the field always serializes.
//
// SCOPE, HONESTLY: this is path coverage, not a visitor-level RED for the omit-content bug itself.
// The agent loop's boundary rescue (forceFinalAnswer) re-synthesises from a clean, tool-less
// message set, so a single 422 on the primary call is masked — the visitor still gets an answer
// and this test stays green even with the guard removed. (An earlier version of this comment
// claimed turn 2 breaks at the visitor level and that prod showed `turns:0` from it. That was
// traced to a malformed curl driving /agent/turn with an empty user message, NOT the real app
// path — prod's app chat works, both turns, verified in-browser. See memory
// prod-chat-regression-eiab.)

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

        // Two tool-calling turns in one conversation — a real visitor holds a multi-turn chat, so
        // the second turn carries the first's tool-calling assistant message in history. Both turns
        // must render an answer over the openai-compat wire.
        await sendToolCallingTurn(page, input, 'tell me what they are about',
          'Turn one — grounded in the corpus.');
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
    // Match prod's SELFTEST-1C22, which carries ghosts (suggested questions), so the seeded code
    // mirrors the real one.
    ghosts: ['What is StandMeet?', 'What has Sijie been building recently?'],
  });
  await request.dispose();
}
