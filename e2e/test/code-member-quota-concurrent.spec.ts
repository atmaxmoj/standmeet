// code-member-quota-concurrent.spec.ts —— 名额上限必须挡得住并发,不然它只是个建议。
//
// 真实环境上看到的:`VERIFY-A01` 显示 `11 / 10 names` —— 11 个成员,上限 10。访客弹窗也照实
// 写着「Up to 10 people can use this code — 11 already in」,而按 START 会被拒。也就是说这张码
// 卡死在一个不该存在的状态里:满了,而且比满还多一个。
//
// 归因:闸门是**先读后写**,中间什么都没有。checkMemberQuota / checkAnonQuota 拿的是另外读出来
// 的 members 切片(visitor.go),而 GetOrCreateMember / CreateAnonymousMember 是裸插入 —— 没有
// 事务、没有行锁,数据库层也没有任何「成员数 ≤ max_members」的约束。两个会话同时开:都读到
// len=9,都判 9 >= 10 不成立,都插入 → 10 变 11。
//
// 这条不模拟并发,它就是并发:同时发起 N 个具名入会,最后数一遍。

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { test, expect } from '@/fixtures/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'quotarace@example.com', password: 'correct-horse-battery-staple',
  handle: 'quotarace', fullName: 'Quota Race Owner',
};

const CODE = 'RACE-CAP1';
const CAP = 5;
// 同时冲进来的人数。要明显多于上限,否则一次侥幸的串行化就把用例蒙过去了。
const RUSH = 12;

test.describe('access-codes · the name cap holds under concurrency', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: CODE, label: 'race', max_members: CAP });
    await request.dispose();
  });

  test('twelve people entering at once cannot push the code past its cap',
    async ({ playwright }) => {
      // 每人一个独立 request context —— 共用一个会串行化,那就测不到并发了。
      const guests = await Promise.all(
        Array.from({ length: RUSH }, () => playwright.request.newContext()),
      );

      // 同一时刻发起:先把 promise 都建出来再 await,不要一个一个等。
      const joins = guests.map((ctx, i) => ctx.post(`${BACKEND}/api/v1/sessions`, {
        data: { mode: 'code', code: CODE, visitor_name: `racer-${i}` },
      }));
      const results = await Promise.all(joins);
      const opened = results.filter((r) => r.status() === 200).length;

      const admin = await playwright.request.newContext();
      const { csrf } = await loginAPI(admin, OWNER.email, OWNER.password);
      const codes = await (await admin.get(`${BACKEND}/api/admin/codes`, {
        headers: { 'X-Csrftoken': csrf },
      })).json() as { code: string; id: string }[];
      const row = codes.find((c) => c.code === CODE);
      const members = await (await admin.get(
        `${BACKEND}/api/admin/codes/${row?.id ?? ''}/members`,
        { headers: { 'X-Csrftoken': csrf } },
      )).json() as unknown[];

      // 判据是**落库的成员数**,不是有几个请求返回 200 —— 后者是客户端看到的,前者是 owner
      // 的配额被吃掉了多少。
      expect(
        members.length,
        `the code may never hold more than its cap; ${opened} sessions opened`,
      ).toBeLessThanOrEqual(CAP);

      await Promise.all([...guests, admin].map((c) => c.dispose()));
    });
});
