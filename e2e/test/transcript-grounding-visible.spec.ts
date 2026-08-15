// transcript-grounding-visible.spec.ts —— F-A-27:owner 得看得见自己的 standpoint 笔记在起作用。
//
// subjectivity 笔记的设计就是**塑造声音但不进访客 footer**(chat-subjectivity check 3),那是故意的。
// 可另一头 tool-call-shape.ts:19 又假设「读了哪些」由 citations footer 承载 —— 两个各自都成立的
// 决定合起来,让那一整个 genre 的读取记录**不存在于任何地方**:访客条只有次数没有 genre,owner
// 的记录只列引用,而私有的那些在写库前就被 show_as_source 闸丢掉了。
//
// 于是 owner 写了一堆 standpoint 笔记来塑造语气,却无从知道它们有没有起过作用 —— 而这一条也正是
// chat-subjectivity check 1 缺的那个观察点。
//
// 这条守两件事,且必须**同时**成立,否则修复要么没效果要么泄露:
//   1. 没 opt-in 的 subjectivity 出现在 owner 记录的 grounding 那一块(标题看得见);
//   2. 它**不**出现在访客侧 —— 访客的引用脚注一个字都不该变。
//
// RED(实现前):grounding 那一块不存在 → 第一条红。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';
import { gotoAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'grounding@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'grounding',
  fullName: 'Grounding Owner',
};
const CODE = 'GROUND-001';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// 私有 standpoint 笔记:默认 show_as_source=false —— 塑造语气,不进访客 footer。
// path 由 subjectivity_write 回参给出(树派生),不自己拼。
const STANCE_TITLE = 'verify-stance';
let stancePath = '';

// 另一条 standpoint 笔记,**opt-in 的**(show_as_source=true):它会真的进引用列表,
// 也就是 `messages.cited_subjectivity_ids`。F-A-39 守的就是这一条 —— prod 上一轮
// 引用了 6 条 subjectivity,而 owner 的逐字稿一行引用都没显示。
const CITABLE_TITLE = 'verify-stance-public';
let citablePath = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

let seeded: { request: APIRequestContext; sid: string; apiToken: string } | null = null;

test.describe.serial('transcript · the owner can see which standpoint notes grounded a turn (F-A-27)', () => {
  test.beforeAll(async ({ playwright }) => {
    seeded = await setup(playwright);
  });

  test.afterAll(async () => {
    await seeded?.request.dispose();
  });

  test('a grounded (non-opt-in) subjectivity note shows up in the owner transcript',
    async ({ adminPage, playwright }) => {
      const request = await playwright.request.newContext();
      const session = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Grounded',
      });
      // 脚本化:这一轮 assistant 去读那条私有 standpoint 笔记。
      const tag = await scriptMockToolCall(request, {
        name: 'corpus_read', args: { path: stancePath },
      });
      await sendAndDrain(request, session, `what do you actually think${tag}`);

      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.getByText('Grounded', { exact: true }).click();
      const modal = adminPage.getByTestId('transcript-body');
      await expect(modal).toBeVisible({ timeout: 10_000 });

      // 断标题看得见 —— 「有没有起作用」正是 owner 要判的那件事,一个计数答不了。
      await expect(
        modal.getByTestId('transcript-grounding'),
        'the transcript must name the standpoint notes that shaped the turn',
      ).toContainText(STANCE_TITLE);

      await request.dispose();
    });

  // F-A-39:**被引用的** subjectivity 也得在 owner 的逐字稿上看得见。
  //
  // 这跟上面那条是同一个 item 的两件事:上面守的是「grounded 但没被引用」的那一类(私有笔记,
  // 塑造语气),这条守的是「已经进了引用列表」的那一类 —— prod 上真跑出来的那一轮
  // `cited_subjectivity_ids` 有 6 条,而逐字稿底下**一行引用都没有**;同一页上只有 wiki 的
  // 那些轮次照常列五行。数据在库里,面把它扔了(`ConvTranscriptModal` 只把 wikiIds/outputIds
  // 交给 CitedTail)。
  //
  // 断的是**标题**而不是「有几行」:owner 要认的是「哪几条笔记」,数字答不了那个问题。
  test('a cited subjectivity note is named in the owner transcript', citedStanceIsNamed);

  // F-A-28:访客那一侧必须一个字都拿不到。
  //
  // 这条一开始是红的,红的原因跟 F-A-27 无关 —— 访客自己的 GET /api/v1/conversations/{id} 把落库的
  // tool_calls 原样吐回去,里面是 corpus_read 的完整结果,含这条私有 standpoint 笔记的**正文**和它
  // 自己的 `"show_as_source":false`。同一份回参里 citations 是空的:引用那道闸做对了,tool_calls
  // 这条道绕开了它。直播那一轮同理(sseSink.ToolCompleted 实时推完整结果)。
  //
  // 断整份 payload 而不是断 citations 数组:后者只覆盖一条通道,而这条缺陷的本质就是「另一条通道」。
  test('the visitor still never sees it', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const session = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Outsider',
    });
    const tag = await scriptMockToolCall(request, {
      name: 'corpus_read', args: { path: stancePath },
    });
    await sendAndDrain(request, session, `same question${tag}`);

    // 访客重载时自己拿的那一份 —— 不是我手里的某个返回值。sendAndDrain 返 void,拿它去
    // JSON.stringify 得到的是 undefined,那种断言过不了也不会真的过,只是看起来在守东西。
    const res = await request.get(
      `${BACKEND}/api/v1/conversations/${session.conversation_id}`,
      { headers: { 'X-Session-Token': session.session_token } },
    );
    expect(res.status(), 'the visitor can load their own conversation').toBe(200);
    const body = await res.text();

    // 先证这份东西**不是空的**,否则「标题不在里面」只是空集的假绿。
    expect(body, 'guard: the turn really is in the visitor view').toContain('same question');
    // 私有 standpoint 笔记一个字段都不许带出来 —— 断「不在 citations 数组里」会漏掉它从
    // 别处渗出去的情况,所以整份 payload 一起看。
    expect(
      body.toLowerCase(),
      'a private standpoint note must not reach the visitor by any field',
    ).not.toContain(STANCE_TITLE);
    await request.dispose();
  });
});

// citedStanceIsNamed —— 见上面那段说明（F-A-39）。
async function citedStanceIsNamed(
  { adminPage, playwright }: { adminPage: Page; playwright: Playwright },
): Promise<void> {
  const request = await playwright.request.newContext();
  const session = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'Cites Stance',
  });
  const tag = await scriptMockToolCall(request, {
    name: 'corpus_read', args: { path: citablePath },
  });
  await sendAndDrain(request, session, `where does taste come in${tag}`);

  await gotoAdminSection(adminPage, 'conversations');
  await adminPage.getByText('Cites Stance', { exact: true }).click();
  const modal = adminPage.getByTestId('transcript-body');
  await expect(modal).toBeVisible({ timeout: 10_000 });
  // 先证这一轮真的落进了逐字稿,否则下面那条断言是在一张空模态上找不到东西。
  await expect(modal, 'the turn is in the transcript').toContainText('where does taste come in');

  await expect(
    modal,
    'a cited subjectivity note must be named in the transcript — the owner has to know '
      + 'WHICH notes were cited, and a count cannot answer that',
  ).toContainText(CITABLE_TITLE, { timeout: 10_000 });

  await request.dispose();
}

async function setup(
  playwright: Playwright,
): Promise<{ request: APIRequestContext; sid: string; apiToken: string }> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'grounding-seed');
  const sid = await initMCP(request, apiToken);
  // subjectivity_write 落一条私有 standpoint 笔记(默认不 opt-in)。path 用它回参给的树派生值。
  const wrote = await callTool<{ subjectivity_id: string; path: string }>(
    request, apiToken, sid, 'subjectivity_write',
    {
      title: STANCE_TITLE, tags: [],
      body: 'I would rather be wrong out loud than vague on purpose.',
    },
  );
  stancePath = wrote.path;
  const citable = await callTool<{ subjectivity_id: string; path: string }>(
    request, apiToken, sid, 'subjectivity_write',
    {
      title: CITABLE_TITLE, tags: [], show_as_source: true,
      body: 'Taste is the part of the work that cannot be delegated.',
    },
  );
  citablePath = citable.path;
  const role = await createRole(request, csrf, {
    name: 'grounding-role', description: 'grounding spec',
    corpus_uris: ['subjectivity://**', 'wiki://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'grounding', assumed_role_id: role.id,
  });
  return { request, sid, apiToken };
}
