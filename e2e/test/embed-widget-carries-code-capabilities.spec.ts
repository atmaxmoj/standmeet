// embed-widget-carries-code-capabilities.spec.ts —— widget 会话拿到的是**整张码**，
// 不是"一个精简版的码"。
//
// 背景（2026-09-01）：一个 embed 把某张码作为 <standmeet-chat code="X"> 暴露到别人网站上。
// 会话签发只在码那条路前面**多加一道来源闸**（embedOriginDenied），闸过了之后走的是跟
// /gate 兑换码**同一个** dispatchIssueSession —— 所以码挂的 role 决定的语料 ACL + 能力，
// 本该原样冻进 widget 会话里。但"本该"不是证据（[[test-covers-capability-not-face]]：
// 走 API 的 e2e 在能力完全没接上时也能绿）。这条测试把它证出来。
//
// 判据成对，正对照在前（[[guard-must-fail-on-the-bug]]）：
//   · 正：从**允许的来源**建的 widget 会话，能取到只有这张码的 role 够得着的那条语料，
//        且它的 capability 列表非空 —— 语料可达 + 能力都跟着码过来了。
//   · 反：一个公开匿名会话（没有这张码）取不到同一条语料 —— 证明上面那半边是**这张码**
//        带来的，不是人人都有。
//
// 只写正对照的话，这条测试在"widget 会话根本没接语料检索"时也可能因为别的原因绿；
// 只写反对照的话，它在语料压根没种进去的今天就是绿的。两半都要。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { createEntry } from '@/fixtures/genre-assets';
import { getRoleByName } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';
import { searchTitles, grepTitles } from '@/fixtures/retrieval';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'embedcaps@example.com', password: 'correct-horse-battery-staple',
  handle: 'embedcaps', fullName: 'Embed Caps Owner',
};

const ALLOWED = 'https://partner.example';
const WIDGET_CODE = 'EMBED-CAPS';

// CV 是一条 subjectivity 条目：`invited`（产品发出去的每一张码的默认档）够不着它，
// 只有 `hiring` role 显式圈了 subjectivity://cv。用它当锚点，才能把"这张码带来的"
// 跟"人人都有的"分开（跟 cv-reachable 用同一条语料、同一个理由）。
const CV_TITLE = 'cv';
const EMPLOYER = 'Northwind Logistics';
const TENURE = '2019-03 → 2022-11';
const CV_BODY = [
  '# Curriculum Vitae',
  '',
  `## ${EMPLOYER} — Senior Backend Engineer`,
  `${TENURE} · Hamilton, ON`,
  '',
  'Owned the dispatch pipeline and its verification harness.',
].join('\n');

// createEmbed —— 建一个 embed（挂在某张码上，钉住来源）。
async function createEmbed(
  request: APIRequestContext, csrf: string, codeID: string, origins: string[],
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/embeds`, {
    headers: { 'X-Csrftoken': csrf },
    data: { code_id: codeID, label: 'partner-site', allowed_origins: origins },
  });
  return res.status();
}

// issueWidgetSession —— 从**宿主站的来源**建一张 code 会话，正是浏览器里 <standmeet-chat>
// 会发的那个跨源 POST（带 Origin 头）。返回解析好的会话，好接 searchTitles/grepTitles。
async function issueWidgetSession(
  request: APIRequestContext, code: string, origin: string,
): Promise<VisitorSession> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: { mode: 'code', code, visitor_name: 'Widget Wanda' },
  });
  if (res.status() !== 200) throw new Error(`widget session failed: ${res.status()}`);
  return await res.json() as VisitorSession;
}

test.describe('embed · a widget session carries the code\'s corpus reach and capabilities', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'embed-caps-spec');
    const sid = await initMCP(request, token);

    // CV 进语料（subjectivity 写口）——只有 hiring role 够得着。
    await createEntry({ request, token, sid }, 'subjectivity', CV_TITLE, CV_BODY);

    // 码挂 hiring（产品自己种的 builtin，不是现编的 glob）。embed 钉住 partner.example。
    const hiring = await getRoleByName(request, 'hiring');
    const code = await createCode(request, csrf, {
      code: WIDGET_CODE, label: 'partner widget', assumed_role_id: hiring.id,
    });
    const embedStatus = await createEmbed(request, csrf, code.id, [ALLOWED]);
    expect(embedStatus, '建 embed 必须成功（201）').toBe(201);
    await request.dispose();
  });

  // ── 正对照：widget 会话真的够得着 CV，且能力跟着码过来了 ──────────────
  test('a widget session from the allowed origin reaches the code\'s corpus',
    async ({ request }) => {
      const sess = await issueWidgetSession(request, WIDGET_CODE, ALLOWED);

      // 语料可达：找得到这篇，而且里面那两个具体事实取得出来
      //（「够得着」= 检索能力 + 语料 ACL 都随码进了这张 widget 会话）。
      expect(await searchTitles(request, sess, EMPLOYER),
        'widget 会话应能检索到码的 role 够得着的语料').toContain(CV_TITLE);
      expect(await grepTitles(request, sess, TENURE),
        'grep 到具体行 = corpus_grep 能力也随码带上了').toContain(CV_TITLE);
    });

  test('the widget session is handed the code\'s capabilities, not a stripped-down set',
    async ({ request }) => {
      const sess = await issueWidgetSession(request, WIDGET_CODE, ALLOWED);
      // 能力列表非空 = 码的 role 授的那组能力冻进了会话。widget 只多一道来源闸，
      // 不该削掉码本来带的能力（[[retrieval-vs-corpus-acl]]：corpus.retrieval 是能力）。
      expect(sess.capabilities?.length ?? 0,
        'widget 会话的 capability 列表不该是空的 —— 码带什么，widget 就带什么').toBeGreaterThan(0);
    });

  // ── 反对照：同一条语料，公开匿名会话够不着 —— 证明上面那半边是**这张码**带来的 ──
  test('a public anonymous session cannot reach the same corpus',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'public', visitor_name: 'Anonymous Ann',
      });
      expect(await searchTitles(request, sess, EMPLOYER)).not.toContain(CV_TITLE);
      expect(await grepTitles(request, sess, TENURE)).not.toContain(CV_TITLE);
    });
});
