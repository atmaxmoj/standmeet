// public-role-published-only.spec.ts —— public 这个身份读到的，就是 owner 发布过的那些（F-D-7）。
//
// 规则（owner 定的，一句话）：**private 的文章没有码就读不到。**
//
// 而"是不是 private"只有一个数据：条目自己的 `published` 开关（`corpus_notes.published`，
// owner 在 /admin/wiki 每条的 PUBLIC LANDING 卡上翻的那个）。`public` 角色**不该另存一份
// 清单**去重新表述同一件事 —— 两份数据必然漂移，而漂移的那一刻没人会收到通知。
//
// 这条驱的是**未受邀访客**那条路：一张不指定 role 的码（"leave blank for public"，跟无码
// BYOAI 落到同一个 builtin 角色）。断言落在访客自己 agent 的工具上 —— `corpus_search` 是
// 访客侧真实的检索面，不是数据库窥探。
//
// RED（修之前）：seed 的两条 wiki 都返回，因为 `PublicRoleCorpusURIs` 授的是 `wiki://**` ——
// "全部"，跟每条自己的开关无关。

import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { getRoleByName } from '@/fixtures/roles';
import { test, expect } from '@/fixtures/test';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'publishedonly@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'publishedonly',
  fullName: 'Published Only Owner',
};
const CODE = 'PUBSCOPE-1';
const PUBLISHED_KEY = 'publishedqx';
const UNPUBLISHED_KEY = 'unpublishedqx';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('the public identity reads what the owner published — and nothing else', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'published-only-seed');
    const sid = await initMCP(request, token);
    const open = await seedWiki(request, token, sid, {
      title: 'Open Note', body: `a note the owner published about ${PUBLISHED_KEY}`,
    });
    await publishEntry(request, token, sid, { genre: 'wiki', id: open.wikiID });
    // 不发布 —— 这条就是 /admin/wiki 上标 `● PRIVATE` 的那种。
    await seedWiki(request, token, sid, {
      title: 'Held Back Note', body: `a note kept private about ${UNPUBLISHED_KEY}`,
    });
    // **显式**挑 builtin `public`：留空现在是 `invited`（发一张码就是一次邀请）。
    // 这条守的是"没被邀请的人看到什么"，所以那个身份必须写出来，不能靠默认。
    const publicRole = await getRoleByName(request, 'public');
    await createCode(request, csrf, {
      code: CODE, label: 'pubscope', assumed_role_id: publicRole.id,
    });
    await request.dispose();
  });

  test('an unpublished entry never reaches a public-identity visitor’s search',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });

      // 正向对照先跑:证明检索这条路是通的,后面那个 0 才有意义
      // ([[assertion-that-cannot-fail]]:一个什么都搜不到的实现也能让下面那条断言过)。
      const openHits = await search(request, sess, PUBLISHED_KEY);
      expect(
        openHits.map((h) => h.title),
        'the published entry IS reachable — otherwise the next assertion proves nothing',
      ).toContain('Open Note');

      const heldHits = await search(request, sess, UNPUBLISHED_KEY);
      expect(
        heldHits.map((h) => h.title),
        'an entry the owner never published must not reach a visitor with no invitation',
      ).toEqual([]);
      await request.dispose();
    });
});

async function search(
  request: APIRequestContext, s: VisitorSession, query: string,
): Promise<Array<{ path?: string; title?: string }>> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/corpus_search`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data: { query } },
  );
  // 不吞状态码：一个拒绝跟"搜到 0 条"在断言里长得一模一样，而它们说的是完全不同的事。
  const text = await res.text();
  expect(res.status(), `corpus_search(${query}) answered ${res.status()}: ${text}`).toBe(200);
  const body = JSON.parse(text) as { result?: Array<{ path?: string; title?: string }> };
  return body.result ?? [];
}
