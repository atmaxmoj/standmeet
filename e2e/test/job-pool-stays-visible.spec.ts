// job-pool-stays-visible.spec.ts —— the owner-side AI must **see today's pool**, not just "the few
// that this particular call happened to newly fetch".
//
// This guard comes from F-E-29: in the real environment prod's pool held 245 live jobs (visible in
// the GUI at /admin/listings, which goes through Pool.ListByOwner), yet when the owner asked "what
// new jobs today" a second time in Claude, `jobs.fetch_new` returned **1** — the rest were all
// judged duplicate and dropped, and the MCP side had no second path to list the pool. Yet the design
// hands the entire "rank / pick which" job to Claude (the division-of-labor table in
// docs/design/job-loop.md), and ranking presupposes being able to see.
//
// Every criterion here lands on the act of **asking a second time within the same day**, because
// that is exactly the shape of the defect: the first ask is always right.

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

  // Every case starts from an **empty pool**. Each case in this file registers its own source and
  // fetches the same fixture, so the same posting has several copies (one per source, collapsed to
  // one by cross-source dedup) — a count assertion on that kind of pool measures "history", not
  // "this run".
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
  // ★ This is the F-E-29 red, **placed first**: the two `new` assertions also go red on the old code
  //   (the field simply does not exist), and placing them first would take the bullet for this one,
  //   so the red the reader sees would not be the defect itself ([[two-guards-dying-at-one-line]]).
  expect(
    new Set(second.jobs.map((j) => j.cache_id)),
    '第二次问：整块板子原样还在（cache_id 一条不少、一条不多）',
  ).toEqual(firstIDs);
  // On the first ask every row is new — written out as a foil for the next assertion: not "this
  // field is always false", but that it is **true when it should be true**.
  expect(
    first.jobs.every((j) => j.new),
    '第一次取数：每一条都是这一趟新进池子的',
  ).toBe(true);
  expect(
    second.jobs.some((j) => j.new),
    '第二次问：没有一条是"新出现的" —— 板子没变，而这句话说得出来',
  ).toBe(false);
  // This run's tally still honestly reports "nothing entered the pool this time": pool visibility
  // and the fetch tally are two different things, and the list coming back full must not make the
  // tally report full too.
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

  // ttl_remaining is part of the fetch_new receipt in the design (the MCP tool surface in
  // docs/design/job-loop.md), and the implementation kept omitting it — without it the owner side
  // has no way to know "is this one still in time today".
  for (const j of fetched.jobs) {
    expect(j.ttl_remaining_seconds, `${j.cache_id} 说得出剩余寿命`)
      .toBeGreaterThan(0);
    expect(j.ttl_remaining_seconds, '不超过池子的 24h 上限')
      .toBeLessThanOrEqual(24 * 60 * 60);
  }

  // Everything ranking needs is in the list; the body is not in the list, it is over in jobs.show.
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

  // Push one row's remaining lifetime down to 1 hour = it entered the pool 23 hours ago.
  // The pooled-at time is not stored separately, it is 24h - remaining TTL, so changing the TTL is
  // changing "how old it is".
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

// ownerWithBoard —— log in, open one MCP session, register a source. Each case registers its own
// source: a source's "which external_ids it has seen" is tracked per source, so sharing one source
// would leave the second case fetching nothing.
async function ownerWithBoard(request: APIRequestContext, label: string) {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, label);
  const sid = await initMCP(request, token);
  const source = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
  });
  return { token, sid, source };
}

// clearPool —— delete all job:* keys (safe under the single-owner v1). Same path as
// job-fetch-ttl-eviction.spec.ts.
function clearPool(): void {
  const script = 'for k in $(redis-cli --scan --pattern "job:*"); do redis-cli DEL "$k"; done';
  execSync(`docker exec standmeet-dev-redis-1 sh -c '${script}'`, { stdio: 'pipe' });
}

// ageOneKey —— push one pool record's remaining lifetime down to seconds, equivalent to "it entered
// the pool (24h - seconds) ago". Goes through docker exec redis-cli, same path as
// job-fetch-ttl-eviction.spec.ts.
function ageOneKey(cacheID: string, seconds: number): void {
  // Use a shell loop instead of `xargs -I{}`: the container is busybox, so do not rest the guard on
  // its xargs dialect ([[gate-can-go-blind]] —— a blind scanner does not error, it just does nothing).
  const script =
    `for k in $(redis-cli --scan --pattern "job:*:${cacheID}"); ` +
    `do redis-cli EXPIRE "$k" ${seconds}; done`;
  execSync(`docker exec standmeet-dev-redis-1 sh -c '${script}'`, { stdio: 'pipe' });
}
