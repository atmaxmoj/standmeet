// job-fetch-multi-source.spec.ts —— register 2 sources of different kinds;
// fetch_new with no source_id returns the union, each tagged with its
// source_kind.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe('jobs.fetch_new across multiple registered sources', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('union of two source kinds returned in one fetch_new call',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'multi-spec');
      const sid = await initMCP(request, token);

      await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      await jobsRegisterSource(request, token, sid, {
        kind: 'lever', label: 'LeverDemo', config: { company: 'leverdemo' },
      });

      const fetched = await jobsFetchNew(request, token, sid);
      const kinds = new Set(fetched.jobs.map((j) => j.source_kind));

      expect(kinds.has('greenhouse')).toBe(true);
      expect(kinds.has('lever')).toBe(true);
      expect(fetched.jobs.length).toBeGreaterThan(0);

      // Every fetched job carries a cache_id (Redis 1d TTL ref)
      for (const j of fetched.jobs) {
        expect(j.cache_id).toMatch(/^[A-Za-z0-9_-]{8,}$/);
      }
    });

  // F-E-6 —— 一个源抓不成，不许把别的源抓到的东西一起扔掉。
  //
  // 手工驱这个模块时撞上的：七个源里只有 workable 的 token 是错的，结果**另外六个真源一条
  // 都没进池子**，owner 拿到的是一句 `jobs.fetch_new failed`，而后端日志里源 id / kind /
  // URL / 原因一应俱全。代码里那一行 `return nil, ferr` 上面的注释写着「单源失败不阻塞其他
  // 源」—— 注释声明的不变量和代码正好相反（[[names-that-lie]]）。
  //
  // 断言两件事，缺一不可：
  //   1. 好源的 job **还在**（这一条在旧代码上必红：旧代码返回 0 条）
  //   2. 坏源在 `failed_sources` 里**被点名**（否则 owner 只知道"少了点什么"，不知道少了哪个）
  // 只断第 1 条的话，一个"悄悄跳过坏源、什么都不说"的实现也能过 —— 那是另一种谎。
  test('one source with bad credentials must not zero out the other sources',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'isolation-spec');
      const sid = await initMCP(request, token);

      const good = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'GoodBoard', config: { company: 'airbnb' },
      });
      const bad = await jobsRegisterSource(request, token, sid, {
        kind: 'workable', label: 'BadToken', config: { company: 'nope', api_token: 'wrong' },
      });

      const fetched = await jobsFetchNew(request, token, sid);

      // 数**这一趟新进池子的**，不是数池子里有多少：回执现在交的是整个窗口
      // （F-E-29），而这个文件里前一条用例已经往同一个池子里放过岗位 ——
      // 用 `jobs.length` 的话，好源一条都没抓到这条用例也会绿（[[assertion-that-cannot-fail]]）。
      expect(
        fetched.jobs.filter((j) => j.new).length,
        `the good source (${good.label}) returned nothing because ${bad.label} failed`,
      ).toBeGreaterThan(0);

      const failed = fetched.failed_sources ?? [];
      expect(
        failed.map((f) => f.label),
        'the failing source must be named, not silently skipped',
      ).toContain('BadToken');
      expect(
        failed.find((f) => f.label === 'BadToken')?.reason ?? '',
        'the reason must carry the upstream detail the log already has',
      ).not.toBe('');
    });
});
