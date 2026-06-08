// anonymous-member-id.spec.ts —— 匿名访客各自一个独立 member(有自己的 id),
// 凭 member_id 续会;不再塌成一个。
//
// 用户故事:
//   两个人都 skip 名字进同一张码 → 各拿一个独立 guest member(不同 member_id /
//   不同对话)。其中一个存着 member_id 再来 → 续上自己那段会。member_id 也各占
//   一个 max_members 名额。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession, issueSessionStatus } from '@/fixtures/visitor';

const OWNER = {
  email: 'anon-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'anonowner',
  fullName: 'Anon Owner',
};

const CODE = 'ANON-3';

test.describe('anonymous visitors are distinct members via member_id', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await issueCodeWithMaxMembers(request);
    await request.dispose();
  });

  test('two anon sessions = distinct members; member_id resumes; counts toward max',
    async ({ request }) => {
      // 两个匿名 session(无名字、无 member_id)→ 两个独立 member + 独立对话。
      const a = await issueSession(request, { handle: OWNER.handle, code: CODE });
      const b = await issueSession(request, { handle: OWNER.handle, code: CODE });
      expect(a.member_id).toBeTruthy();
      expect(b.member_id).toBeTruthy();
      expect(a.member_id).not.toBe(b.member_id);
      expect(a.conversation_id).not.toBe(b.conversation_id);

      // 凭 a 的 member_id 续会 → 同一个 member + 同一段对话。
      const aAgain = await issueSession(request, {
        handle: OWNER.handle, code: CODE, member_id: a.member_id,
      });
      expect(aAgain.member_id).toBe(a.member_id);
      expect(aAgain.conversation_id).toBe(a.conversation_id);

      // 已经 2 个匿名 member 了(max_members=3),第 3 个新名字还行,第 4 个满。
      const named = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Carol',
      });
      expect(named.member_id).toBeTruthy();
      const overflow = await issueSessionStatus(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Dave',
      });
      expect(overflow).toBe(403);
    });
});

async function issueCodeWithMaxMembers(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'anon-seed');
  await createCode(request, csrf, {
    code: CODE, label: 'Anon member-id test', max_members: 3,
  });
}
