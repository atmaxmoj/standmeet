// job-pool-stays-visible.spec.ts —— owner 那一侧的 AI 要**看得见今天的池子**，
// 而不是只看见"这一次调用碰巧新捞上来的那几条"。
//
// 这条守卫来自 F-E-29：真环境里 prod 的池子躺着 245 条活岗位（GUI 的
// /admin/listings 看得见，它走 Pool.ListByOwner），而 owner 在 Claude 里
// 第二次问「今天有什么新工作」，`jobs.fetch_new` 回的是 **1 条** —— 其余全被
// 判为 duplicate 丢掉了，MCP 那一面再没有第二条路能列出池子。
// 而设计把「排序 / 挑哪条」整件事交给 Claude（docs/design/job-loop.md 的分工表），
// 排序的前提是看得见。
//
// 这里的判据都落在**同一天里问第二次**这个动作上，因为那正是缺陷的形状：
// 第一次问永远是对的。

import { execSync } from 'node:child_process';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import {
  jobsDiscard, jobsFetchNew, jobsRegisterSource, jobsShow,
} from '@/fixtures/jobs';

const OWNER = {
  email: 'jobpool@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'jobpool',
  fullName: 'Job Pool',
};

test.describe('今天的池子对 owner 那一侧始终可见', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  // 每条用例都从**空池子**开始。这个文件里每条都自己注册一个源、抓同一份 fixture，
  // 于是同一条 posting 会有好几份副本（每个源一份，靠跨源去重收成一条）——
  // 数条数的断言在那种池子上量的是"历史"，不是"这一次"。
  test.beforeEach(() => {
    clearPool();
  });

  test('同一天问第二次，拿回的还是整块板子，不是空数组', expectBoardSurvivesASecondAsk);
  test('每一行都说得出自己还能活多久，正文去 jobs.show 拿', expectTTLAndBodySplit);
  test('since_hours 真的按入池时间裁，越界的那条不回来', expectWindowTrimsByPooledAt);
  test('since_hours 给 0 当场说清楚，不悄悄当成"整个池子"', expectZeroWindowRefused);
  test('discard 过的不再出现在板子上', expectDiscardedStaysGone);
});

async function expectBoardSurvivesASecondAsk(
  { request }: { request: APIRequestContext },
): Promise<void> {
  const { token, sid, source } = await ownerWithBoard(request, 'jobpool-spec');

  const first = await jobsFetchNew(request, token, sid, source.id);
  expect(first.jobs.length, '前置条件：第一次取数捞到了岗位').toBeGreaterThan(0);
  const firstIDs = new Set(first.jobs.map((j) => j.cache_id));

  const second = await jobsFetchNew(request, token, sid, source.id);
  // ★ 这一条就是 F-E-29 的红，**排在最前面**：`new` 那两条断言在旧代码上也红
  //   （字段根本不存在），排在前面就会替这一条挡枪，让人看见的红不是缺陷本身
  //   （[[two-guards-dying-at-one-line]]）。
  expect(
    new Set(second.jobs.map((j) => j.cache_id)),
    '第二次问：整块板子原样还在（cache_id 一条不少、一条不多）',
  ).toEqual(firstIDs);
  // 第一次问的时候每一条都是新的 —— 写出来是给下面那句做对照：不是"这个字段恒为
  // false"，是它**该 true 的时候 true**。
  expect(
    first.jobs.every((j) => j.new),
    '第一次取数：每一条都是这一趟新进池子的',
  ).toBe(true);
  expect(
    second.jobs.some((j) => j.new),
    '第二次问：没有一条是"新出现的" —— 板子没变，而这句话说得出来',
  ).toBe(false);
  // 这一趟的账仍然如实报"这次一条都没进池子"：池子可见跟取数的账是两件事，
  // 不能因为列表回满了就把 tally 也说成满的。
  const tally = (second.sources ?? []).find((t) => t.source_id === source.id);
  expect(tally?.pooled, '第二趟确实一条都没新进池子').toBe(0);
  expect(tally?.duplicate, '它们都被认成见过的').toBe(first.jobs.length);
}

async function expectTTLAndBodySplit(
  { request }: { request: APIRequestContext },
): Promise<void> {
  const { token, sid, source } = await ownerWithBoard(request, 'jobpool-spec-2');
  const fetched = await jobsFetchNew(request, token, sid, source.id);
  const row = fetched.jobs[0]!;

  // ttl_remaining 是设计里 fetch_new 回执的一部分（docs/design/job-loop.md
  // 的 MCP tool surface），实现一直漏着 —— 没有它，owner 那侧无从知道
  // "这条今天还来不来得及"。
  for (const j of fetched.jobs) {
    expect(j.ttl_remaining_seconds, `${j.cache_id} 说得出剩余寿命`)
      .toBeGreaterThan(0);
    expect(j.ttl_remaining_seconds, '不超过池子的 24h 上限')
      .toBeLessThanOrEqual(24 * 60 * 60);
  }

  // 排序要用的东西列表里都有；正文不在列表里，在 jobs.show 那边。
  expect(row.title.length, '标题在列表里').toBeGreaterThan(0);
  expect(row.company.length, '公司在列表里').toBeGreaterThan(0);
  expect(
    (row as unknown as { body_text?: string }).body_text,
    '正文**不**在列表里：几百条正文会把 owner 那侧的上下文烧光',
  ).toBeUndefined();

  const full = await jobsShow(request, token, sid, row.cache_id);
  expect(full.body_text?.length ?? 0, '正文在声明发正文的那个工具那里')
    .toBeGreaterThan(0);
}

async function expectWindowTrimsByPooledAt(
  { request }: { request: APIRequestContext },
): Promise<void> {
  const { token, sid, source } = await ownerWithBoard(request, 'jobpool-spec-3');
  const fetched = await jobsFetchNew(request, token, sid, source.id);
  expect(fetched.jobs.length, '前置条件：捞到了岗位').toBeGreaterThan(1);
  const aged = fetched.jobs[0]!;

  // 把其中一条的剩余寿命压到 1 小时 = 它 23 小时前就进池子了。
  // 入池时间不另存，就是 24h - 剩余 TTL，所以改 TTL 就是改"它多老"。
  ageOneKey(aged.cache_id, 60 * 60);

  const wide = await jobsFetchNew(request, token, sid, source.id, 24);
  expect(
    wide.jobs.map((j) => j.cache_id),
    '24 小时的窗口里，那条 23 小时前的还在',
  ).toContain(aged.cache_id);

  const narrow = await jobsFetchNew(request, token, sid, source.id, 2);
  expect(
    narrow.jobs.map((j) => j.cache_id),
    '2 小时的窗口里，那条 23 小时前的出局',
  ).not.toContain(aged.cache_id);
  expect(
    narrow.jobs.length,
    '窗口只裁掉那一条，其余的还在 —— 不是把整个池子裁没了',
  ).toBe(fetched.jobs.length - 1);
}

async function expectZeroWindowRefused(
  { request }: { request: APIRequestContext },
): Promise<void> {
  const { token, sid } = await ownerWithBoard(request, 'jobpool-spec-4');
  await expect(
    jobsFetchNew(request, token, sid, undefined, 0),
  ).rejects.toThrow(/since_hours must be greater than 0/i);
}

async function expectDiscardedStaysGone(
  { request }: { request: APIRequestContext },
): Promise<void> {
  const { token, sid, source } = await ownerWithBoard(request, 'jobpool-spec-5');
  const fetched = await jobsFetchNew(request, token, sid, source.id);
  const dropped = fetched.jobs[0]!;
  await jobsDiscard(request, token, sid, dropped.cache_id);

  const again = await jobsFetchNew(request, token, sid, source.id);
  expect(
    again.jobs.map((j) => j.cache_id),
    '扔掉的那条不该被"整块板子回来了"这条修法重新塞回 owner 眼前',
  ).not.toContain(dropped.cache_id);
  expect(again.jobs.length, '其余的照常在').toBe(fetched.jobs.length - 1);
}

// ownerWithBoard —— 登录、开一条 MCP 会话、注册一个源。每条用例各注册各的源：
// 源的「见过哪些 external_id」是按源记的，共用一个源的话第二条用例就一条都捞不到。
async function ownerWithBoard(request: APIRequestContext, label: string) {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, label);
  const sid = await initMCP(request, token);
  const source = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
  });
  return { token, sid, source };
}

// clearPool —— 删掉全部 job:* key（单 owner 的 v1，安全）。跟
// job-fetch-ttl-eviction.spec.ts 同一条路。
function clearPool(): void {
  const script = 'for k in $(redis-cli --scan --pattern "job:*"); do redis-cli DEL "$k"; done';
  execSync(`docker exec standmeet-dev-redis-1 sh -c '${script}'`, { stdio: 'pipe' });
}

// ageOneKey —— 把一条池子记录的剩余寿命压到 seconds，等价于"它 (24h - seconds) 前进的池子"。
// 走 docker exec redis-cli，跟 job-fetch-ttl-eviction.spec.ts 同一条路。
function ageOneKey(cacheID: string, seconds: number): void {
  // 用 shell 循环而不是 `xargs -I{}`：容器里是 busybox，别把守卫压在它的 xargs 方言上
  // （[[gate-can-go-blind]] —— 扫描器失明时不报错，只是什么都不做）。
  const script =
    `for k in $(redis-cli --scan --pattern "job:*:${cacheID}"); ` +
    `do redis-cli EXPIRE "$k" ${seconds}; done`;
  execSync(`docker exec standmeet-dev-redis-1 sh -c '${script}'`, { stdio: 'pipe' });
}
