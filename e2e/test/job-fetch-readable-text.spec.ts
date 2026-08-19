// job-fetch-readable-text.spec.ts —— 取回来的岗位必须是**文字**，不是标记。
//
// 真环境驱出来的（F-E-7）：prod 上 521 条真岗位里，`hn_hiring` 那些行在 `/admin/listings`
// 上整行都是原始标记 ——
//   `IVPN | Infrastructure Engineer &#x2F; Sysadmin | Remote (…) | Full-time | <a href="https:&#x2F;…`
// 而 greenhouse 那条路的 body 是**双重转义**的 HTML：`&lt;div class=&quot;content-intro&quot;&gt;…`。
// 连 HTML 解析器都救不了后者，它看到的是字面的 `&lt;div&gt;`。
//
// **别把它跟那条已声明的设计搞混**：`hn_hiring.go:12-13` 写着「不解析 comment 内容结构 ——
// 当 raw text 传给 agent 让 Claude 自己读」。那句话管的是**结构**（Company | Title | Location
// 那种切分），不是「把 HTML 实体和标签留在展示字段里」。title 是给人看的一格。
//
// 缺的是一个机制而不是一个字段：整条 jobs 取数路径上 `html.UnescapeString` / strip-tags 零命中。
// 所以这条 spec 断两个源，一个都不能少 —— 只断 HN 的话，一个"在 HN 适配器里补一刀"的修法
// 也能过，而 greenhouse 的 body 照样是 `&lt;div&gt;` 汤。

// **同一个函数的第二半（UX-88）**：`readableJobs` 头上写着「每个源交回来的字都要变成文字
// 再进池子 —— 这是它们唯一的汇合点」，然后只扫了 title 和 body_text。location 没人管，
// 于是 RemoteOK 发的 `"San Francisco, "`（城市 + 空地区，逗号裸露在末尾）原样印到
// `/admin/listings` 上，读作 `remoteok · Karratha,`。
// 这一条把那句话的其余部分补上：**外来数据在入口处规范化一次**（全局规矩第 4 条）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource, MOCK_BASE } from '@/fixtures/jobs';

const OWNER = {
  email: 'jobtext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'jobtext',
  fullName: 'Job Text Owner',
};

// MARKUP —— 一条真岗位的字面上永远不该出现的东西。都是从 prod 那一屏上抄下来的。
const MARKUP = [/&#x2F;/, /&#x27;/, /&amp;/, /&lt;/, /&quot;/, /<a\s/i, /<p>/i, /<div/i];

function expectReadable(label: string, text: string): void {
  for (const re of MARKUP) {
    expect(text, `${label} must read as text, not markup (${re})`).not.toMatch(re);
  }
}

test.describe('jobs · a fetched posting reads as text, not markup', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('the HN free-form source yields a readable title', async ({ request }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'jobtext-spec');
    const sid = await initMCP(request, token);

    await jobsRegisterSource(request, token, sid, {
      kind: 'hn_hiring', label: 'HN Who is Hiring', config: {},
    });
    const fetched = await jobsFetchNew(request, token, sid);
    const hn = fetched.jobs.filter((j) => j.source_kind === 'hn_hiring');
    // 前置条件要**准确**，不是 `> 0`。这一帖的 fixture 有 8 条顶层评论、没有一条被删，
    // 所以应当是 8 条。`toBeGreaterThan(0)` 在真实环境里眼睁睁放过了一次
    // **98 条塌成 1 条**（F-E-24）：HN 的 URL 是 `item?id=…`，而跨源去重的 canonical
    // key 把 query string 整个丢掉，于是全帖每一条的 key 都是同一个
    // `https://news.ycombinator.com/item`（[[assertion-that-cannot-fail]]）。
    expect(hn, '这一帖 fixture 的 8 条顶层评论都要活下来').toHaveLength(8);
    const urls = new Set(hn.map((j) => j.url));
    expect(urls.size, '每条各有各的 URL（塌成一条的话这里是 1）').toBe(8);

    // **逐条取的源要交代自己跳过了什么**（F-E-19）：光看条数读不出「今天没人招」
    // 「被限流了」「判定条件写错了」的区别。账要说：上游一共几条、我们看了几条、
    // 按原因各跳过几条。
    const tally = (fetched.sources ?? []).find((t) => t.kind === 'hn_hiring');
    expect(tally?.available, '上游那帖一共 8 条顶层评论').toBe(8);
    expect(tally?.read, '我们把这 8 条都过了一遍').toBe(8);
    expect(tally?.skipped, '跳过要按原因分开计数，不是一个总数').toEqual({
      fetch_failed: 0, deleted_or_empty: 0,
    });

    for (const j of hn) {
      expectReadable(`hn title (${j.cache_id})`, j.title);
    }
  });

  test('a board that ships HTML yields a readable body', async ({ request }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'jobtext-spec-2');
    const sid = await initMCP(request, token);

    await jobsRegisterSource(request, token, sid, {
      kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
    });
    const fetched = await jobsFetchNew(request, token, sid);
    const gh = fetched.jobs.filter((j) => j.source_kind === 'greenhouse');
    expect(gh.length, 'precondition: the greenhouse fixture produced postings').toBeGreaterThan(0);

    const withBody = gh.filter((j) => (j.body_text ?? '').length > 0);
    expect(withBody.length, 'precondition: at least one posting carries a body').toBeGreaterThan(0);
    for (const j of withBody) {
      expectReadable(`greenhouse body (${j.cache_id})`, j.body_text ?? '');
    }
  });

  test('a board that ships a dangling separator yields a clean location', async ({ request }) => {
    // **前置条件先对着替身本人验**（[[assertion-that-cannot-fail]]）：如果哪天有人"顺手"
    // 把 fixture 里的尾随逗号擦掉，下面那组断言会全绿 —— 绿得毫无信息。所以先去问替身
    // 到底发了什么，发不出脏数据就直接判这条用例失败，而不是让它安静地通过。
    await expectStandInStillShipsDanglingLocations(request);

    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'jobtext-spec-3');
    const sid = await initMCP(request, token);

    await jobsRegisterSource(request, token, sid, {
      kind: 'remoteok', label: 'RemoteOK', config: {},
    });
    const fetched = await jobsFetchNew(request, token, sid);
    const rok = fetched.jobs.filter((j) => j.source_kind === 'remoteok');
    expect(rok.length, 'precondition: the remoteok fixture produced postings').toBeGreaterThan(0);

    expectCleanLocations(rok);
  });
});

// expectStandInStillShipsDanglingLocations —— **前置条件对着替身本人验**
// （[[assertion-that-cannot-fail]]）：哪天有人"顺手"把 fixture 里的尾随逗号擦掉，
// 下面那组断言会全绿 —— 绿得毫无信息。所以先去问替身到底发了什么，发不出脏数据就判失败。
async function expectStandInStillShipsDanglingLocations(
  request: APIRequestContext,
): Promise<void> {
  const upstream = await request.get(`${MOCK_BASE}/remoteok/api`);
  expect(upstream.ok(), 'precondition: the job-board stand-in answers').toBeTruthy();
  const raw = (await upstream.json()) as { id?: string; location?: string }[];
  const dangling = raw.filter((e) => e.id && DANGLING.test(e.location ?? ''));
  expect(
    dangling.length,
    'precondition: RemoteOK really does ship "City, " with an empty region — '
    + 'if this is 0 the fixture was scrubbed and this whole test proves nothing',
  ).toBeGreaterThan(0);
}

const DANGLING = /[,;\-–]\s*$/;

function expectCleanLocations(jobs: { cache_id: string; location: string }[]): void {
  for (const j of jobs) {
    expect(
      j.location,
      `remoteok location (${j.cache_id}) must not end on a separator — `
      + 'the listing reads "remoteok · Karratha," to the owner',
    ).not.toMatch(DANGLING);
    expect(
      j.location,
      `remoteok location (${j.cache_id}) must not carry edge whitespace`,
    ).toBe(j.location.trim());
  }
  // 归一化不许把内容吃掉：「城市, 地区」两段都在的那种必须原样留着。
  for (const j of jobs.filter((x) => x.location.includes(','))) {
    expect(
      j.location,
      'a genuine "City, Region" must survive normalisation intact',
    ).toMatch(/[^,\s],\s*\S/);
  }
}
