// turn-truncated-says-so.spec.ts -- F-A-34. When the model runs out of **output
// budget**, that half-sentence must not pass itself off as a complete answer.
//
// A generation ends in one of three ways: it finished speaking (end_turn), it wants to
// call a tool (tool_use), or **it ran out of budget** (max_tokens). The third case isn't
// an error -- the stream closes normally -- so the agent loop's "every budget exhaustion
// needs an engineered boundary" design (agent_loop_budget.go wires forceFinalAnswer for
// iteration/timeout/terminal errors) misses exactly this case: the turn ends normally,
// the body stops mid-sentence, and a REFERENCES footer follows right after, as usual.
//
// What it looks like when hit in the real environment (prod, a real vault, a 190-second
// long turn): the body of item 35 was "Voice as a trainable, transferable property --
// **which is**", and then nothing.
//
// And this information is **available the whole time**: `agent_loop.go:326` normalizes
// the provider's finish reason into end_turn|tool_use|max_tokens, `:152`'s
// sink.Done(state.stop) sends it to the browser as the SSE `stop_reason`, and the SDK's
// agent-turn-sse.ts:115 dutifully parses it into stopReason -- and then nowhere else in
// the entire repo ever references it again. What's missing isn't the plumbing, it's the
// **consumer**.
//
// This guard goes through the visitor's real interface: registers a reply that ends on
// max_tokens, and asserts that half-sentence has **a notice right next to it saying it
// wasn't finished** (reusing the partial-notice slot F-A-32 built: the truncated body,
// the citations, and a human-readable sentence all stay in place).

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import {
  scriptMockReplyText, scriptMockReplyTruncated, scriptMockToolCall,
} from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'trunc@example.com',
  password: 'truncated-turn-pass-1',
  handle: 'trunc',
  fullName: 'Truncated Turn Owner',
};

const CODE = 'TRUNC-001';
// A half-sentence -- this is exactly the shape it took in the real environment: the
// sentence stops on a conjunction.
const HALF = 'Voice is a trainable, transferable property — which is';
const WHOLE = 'Voice is a trainable, transferable property, and that is the whole answer.';

test.describe('F-A-34 · a turn cut short by the output budget says so', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance takes ~48s under high load, while the hook
                              // only gives 30s by default
    await initOwner(playwright);
  });

  test('the half sentence carries a notice; a complete answer carries none',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await enterCodeSession(page, CODE, 'Reader');

      // 1) The turn that runs out of budget.
      const cutTag = await scriptMockReplyTruncated(request, HALF);
      await ask(page, `tell me about voice ${cutTag}`);
      const notice = page.getByTestId('answer-partial-notice');
      await expect(notice,
        'the visitor is told the answer stopped early, instead of reading half a clause as finished')
        .toBeVisible({ timeout: 20_000 });
      // Reads the text before asserting: `.not.toContainText` would also pass while the
      // element hasn't appeared yet.
      //
      // The criterion isn't "is there a notice at all", it's **that it speaks the same
      // language as the neighboring exhaustion state** (UX-84): running out of a
      // per-session quota reads `SESSION FULL`, running out of output budget should read
      // `TURN FULL` -- the same word stem. This used to assert `/cut short/`, a sentence
      // I made up myself with no design behind it, and it also over-promised an "ask for
      // the rest" (there's no rest at all when `answer_chars=0`).
      const said = (await notice.innerText()).toLowerCase();
      expect(said, '到头了要跟隔壁的 session full 说同一种话，而不是自造一句')
        .toMatch(/turn full/);
      expect(said, '不许许诺一个不存在的「剩下的部分」').not.toMatch(/rest/);
      // **Each kind of wall states its own reason** (UX-84): asserting `turn full` alone
      // would still pass green even if it were hardcoded as a single constant string,
      // and that is exactly the shape of this defect. This asserts that **it names which
      // wall was hit** -- this turn specifically hit the output budget.
      expect(said, '要说出撞的是哪一种墙，而不是所有情形共用一句')
        .toMatch(/output budget/);

      // 2) The inverse: a turn that finished normally must **not** carry this notice --
      // a notice on every turn is the same as no notice at all.
      // Counts the total: the first turn's notice is still there (1), the second turn
      // must not add another.
      const wholeTag = await scriptMockReplyText(request, WHOLE);
      await ask(page, `and again ${wholeTag}`);
      await expect(page.getByText('the whole answer', { exact: false }))
        .toBeVisible({ timeout: 20_000 });
      expect(await notice.count(),
        'a complete answer adds no cut-short notice of its own').toBe(1);

      await request.dispose();
    });

  // F-A-40 -- the **harsher end** of the same path: the body is **empty** when the
  // budget runs out.
  //
  // What it looked like when driven by a real model in prod: `SEARCHED 51 · READ 4` ->
  // empty body -> a sentence saying "this answer was cut short -- ask for the rest",
  // when there was no rest at all. The logs read `stop=max_tokens answer_chars=0`: it
  // didn't hit a timeout, didn't hit the iteration cap -- the model spent **its entire
  // output budget** on tool calls and wrote not a single character. That isn't an error,
  // so it slips past the handleTerminalError seam -- this path used to have only a
  // budget and no engineered boundary, and this criterion's very first line states "the
  // boundary is engineered; a bigger budget is not one".
  //
  // What's built here is exactly that shape: run a real retrieval first (so the evidence
  // is in hand), then let that turn end on max_tokens with an empty body. Asserts the
  // visitor **gets an answer** (the product of the boundary's tool-free synthesis), not a
  // sentence telling them to ask for the rest.
  test('预算用完、一个字都没写的那一轮:访客拿到的是答案,不是一句「去问剩下的」',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await enterCodeSession(page, CODE, 'Reader');

      const toolTag = await scriptMockToolCall(request, {
        name: 'corpus_search', args: { query: 'voice' },
      });
      // Empty body + max_tokens: the model spent its entire budget on the tool.
      const emptyTag = await scriptMockReplyTruncated(request, '');
      await ask(page, `crawl everything about voice ${toolTag}${emptyTag}`);

      // The boundary's synthesis pass has no script to work from -> the mock echoes its
      // default line. **Having text at all** is what this test needs to prove.
      // Takes the **last** one: this screen also has the welcome message from entry, so
      // `answer-body` isn't unique.
      //
      // The criterion lands on **the fingerprint of the boundary's synthesis pass**,
      // not "there's text on screen": the mock echoes the system prompt verbatim, and
      // only the forced-closure pass's system prompt carries that nudge
      // (`forceFinalNudge`). Asserting mere "non-empty" would still pass green some day
      // if a normal turn leaked out half a sentence instead.
      await expect(
        page.getByTestId('answer-body').last(),
        '预算用完不等于访客空手而归 —— 证据都在手上,边界要把它合成成一个答案',
      ).toContainText('used your search budget for this turn', { timeout: 30_000 });
      expect(
        await page.getByTestId('answer-partial-notice').count(),
        '救回来之后不该再说「这条没说完、去问剩下的」—— 没有剩下的',
      ).toBe(0);

      await request.dispose();
    });

  // F-A-35 -- the branch where **nothing was answered at all, and there's no rescuing
  // it**.
  //
  // The only difference from the test above (evidence in hand -> the boundary synthesizes
  // an answer) is the evidence: here **not a single tool was called**, `ensureProduct`'s
  // early-return for `len(evidence) == 0` lets it through as-is, leaving the body empty.
  // This turn used to share the same "ask for the rest" sentence with "cut off midway" --
  // but the visitor has **literally nothing at all**, no rest to ask for. The criterion is
  // whether the sentence they read can tell these two situations apart.
  test('一个字都没答出来、也救不回来:说的是「这一轮没有答案」,不是「去问剩下的」',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await enterCodeSession(page, CODE, 'Reader');

      // Empty body + max_tokens, **and no tool call is scripted at all** -> no evidence
      // available to synthesize from.
      const emptyTag = await scriptMockReplyTruncated(request, '');
      await ask(page, `tell me everything ${emptyTag}`);

      const notice = page.getByTestId('answer-partial-notice');
      await expect(notice).toBeVisible({ timeout: 20_000 });
      const said = (await notice.innerText()).toLowerCase();
      expect(said, '手里一个字都没有的时候，要说的是「这一轮没有答案」')
        .toMatch(/no answer this turn/);
      expect(said, '没有 rest 可问，就不许提 rest').not.toMatch(/rest/);
      expect(said, '这一类不是「满了」—— 满了意味着有东西装进去了')
        .not.toMatch(/turn full/);

      await request.dispose();
    });
});

async function ask(page: Page, q: string): Promise<void> {
  await page.getByTestId('chat-input-field').fill(q);
  await page.getByTestId('chat-input-field').press('Enter');
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'trunc-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'voice as instrument intro.', title: 'Voice Intro',
  });
  await createCode(request, csrf, { code: CODE, label: 'Truncation' });
  await request.dispose();
}
