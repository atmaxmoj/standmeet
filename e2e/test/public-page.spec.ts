// public-page.spec.ts —— 访客的 end-to-end 用户流程。
//
// 用户故事：
//   一个陌生访客打开 owner 的 StandMeet 公开页，读到 owner 的 hero
//   prose、看到 insights / projects / where / contact 全部 section，
//   然后在 chat dock 输入问题、按 Enter。无码访客**不行内答** —— 一律
//   hand off 到 /gate(问题用 ?q= 带过去；见 commit 485bf66 + page-shell.onAsk)。
//   填一个 code 过闸后回到 ChatRoom，带过去的问题被接着答，回复底部标注
//   引用了多少条 corpus entry。
//
// e2e 零 goto：claim + seed wiki + 发 code 在 beforeAll 走 API；page fixture
// 自动 goto('/') 之后 instance 已 claimed → 渲染公开页(不 redirect /setup)。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const CODE = 'PUBLIC-1';
const QUESTION = 'tell me about alice';
// Explicit path so the migrated turn can register a corpus_read on it (a
// corpus_read is what records the citation the footnote asserts).
const INTRO_PATH = 'alice-intro';

test.describe("visitor reads owner's public page and chats with the persona", () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken());
    const { csrf } = await login(request);
    // 过闸用的 code 挂一个能读 corpus 的 role(wiki://**)→ 回答能引用、出脚注。
    const role = await createRole(request, csrf, {
      name: 'full', description: 'wiki://**', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, { code: CODE, label: 'public', assumed_role_id: role.id });
    const apiToken = await createAPIToken(request, csrf);
    const sid = await initMCP(request, apiToken);
    await seedWiki(request, apiToken, sid, {
      body: 'alice loves ASCII sparklines.',
      title: 'Alice intro',
      path: INTRO_PATH,
    });
    await request.dispose();
  });

  test('visitor sees full page, asks → hands off to /gate → over the gate the question is answered + cited',
    async ({ page }) => {
      await expectOwnerPageRendered(page);
      // Mock is pure registration: register the corpus_read whose result records
      // the citation the footnote asserts. The tag rides in the question, which
      // is carried through the /gate ?q= handoff and auto-asked over the gate —
      // so the read fires on that carried turn.
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: INTRO_PATH },
      });
      await visitorAsksAQuestion(page, `${QUESTION}${readTag}`);
      await expectHandoffToGate(page);
      await enterCodeAtGate(page, CODE);
      await expectCarriedQuestionAnswered(page);
      await expectCitationFootnote(page);
    });
});

async function expectOwnerPageRendered(page: Page): Promise<void> {
  // 设计稿里 owner 全名摆 identity strip 里（mono caps span 不是 heading），
  // 所以走 getByText 而不是 getByRole('heading')。
  await expect(page.getByText('Alice Anderson')).toBeVisible();
  // section 标题永远在（即使内容为空 section header 还是渲）
  await expect(page.getByText("things I've been thinking about")).toBeVisible();
  await expect(page.getByText("what I'm building")).toBeVisible();
  await expect(page.getByText('where I am', { exact: true })).toBeVisible();
  await expect(page.getByText('how to talk to me', { exact: true })).toBeVisible();
  // hero example starter 来自 defaultHeroExamples（generic placeholder）
  await expect(page.getByText('What are you working on?')).toBeVisible();
  // insights / projects 默认空——owner 不填就不显内容，spec 不再 assert
  // 真实 insight 标题或 project 名字
  // F-A-21: the page is visitor-facing, so an UNCONFIGURED instance (this fresh claim, no page
  // config) must not show owner-onboarding copy to a visitor. The old default hero prose told the
  // reader to "Open /admin/page", and defaultWhere leaked "Edit your location in /admin/page." —
  // nonsensical/leaky to a visitor (esp. a coded one who can't reach /admin). Invariant (the class,
  // not one string): a visitor-facing surface never references /admin at all.
  await expect(page.getByText(/\/admin/)).toHaveCount(0);
  await expect(page.getByText('This is your StandMeet page')).toHaveCount(0);
  // Same class, frontend side: an unconfigured contact must not render the dangling
  // "Or directly:" label (empty mailto) — empty fields render nothing, not scaffolding.
  await expect(page.getByText('Or directly:')).toHaveCount(0);
}

async function visitorAsksAQuestion(page: Page, question: string): Promise<void> {
  // 新 AskInput 是 input[type=text]，不是 textarea；form submit on Enter。
  const input = page.locator('[data-testid="chat-input-field"]');
  await input.fill(question);
  await input.press('Enter');
}

// expectHandoffToGate —— 无码提问不行内答：落到 /gate，问题用 ?q= 带过去。
async function expectHandoffToGate(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/gate\?.*q=/, { timeout: 5_000 });
}

// enterCodeAtGate —— 在 /gate 填码进会话；过闸后 ?q= 串回 / 续答。
async function enterCodeAtGate(page: Page, code: string): Promise<void> {
  await page.getByTestId('gate-code').fill(code);
  await page.getByTestId('gate-visitor-name').fill('Sarah (Acme HR)');
  await page.getByTestId('gate-code-submit').click();
}

async function expectCarriedQuestionAnswered(page: Page): Promise<void> {
  // ConversationDeck 把回复挂在 data-testid="answer-body" 里。带过去的问题
  // 被 ChatRoom 自动 ask(不丢)→ 流式回复落到 answer-body。
  await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="answer-body"]'))
    .toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(QUESTION)).toBeVisible();
}

async function expectCitationFootnote(page: Page): Promise<void> {
  // 引用块现在像普通 AI chat:默认折叠成一行 "references · N"(点开看列表)。
  const cited = page.locator('[data-testid="citations"]');
  await expect(cited).toBeVisible({ timeout: 5_000 });
  await expect(cited).toContainText('references');
}
