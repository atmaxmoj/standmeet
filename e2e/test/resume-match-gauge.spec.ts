// resume-match-gauge.spec.ts —— 简历 composer 顶栏的 "match NN / 100" 表必须**真**跟 JD 有关，
// 不能顶着 "match against the job description" 的 tooltip 却对 JD 一无所知。
//
// rot-A2（HIGH）：这个数是 confidenceScore(draft-model.ts:143) = min(0.98, 0.5 + hits*0.03)，
// hits = 一串**写死的** buzzword（retrieval/eval/evaluation/llm/rag/brain/lucerna/launch,
// DEFAULT_KEYWORDS l.157）在 summary+skills+experience+coverLetter 里出现的次数，50% 起步。
// 它**从不读**这份简历投给哪份工作 —— draft 的 job context 只有 company+role，DraftModel 里
// **根本没有 JD 字段**。于是同一份简历投任何岗位，这个数**永远一模一样**，却摆在 Send 旁边、
// 顶着 tooltip "match against the job description"。owner 拿它决定要不要真的投出一份求职申请。
//
// RED 判据（选 owner 会捍卫的那条契约 —— 见文件末尾说明）：
//   打开 composer，读一次 match 数；把这份简历**投的岗位**（header 面板的 company+role，
//   draft 唯一携带的 job context）换成一份完全不同的工作，简历本身一字不动；再读一次。
//   "说谎" = 顶着 "match against the job description" 的数，在 JD 变了之后**纹丝不动**。
//   诚实的收尾（任一即绿）：数字跟着岗位变了(接真 JD 评分) / 或那条 JD tooltip 没了(删表/改标)。
// 当前代码：company+role 根本不进 confidenceScore 的打分文本 → 两次读数必然相等 → RED。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Locator, Page, Playwright } from '@playwright/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'match-gauge-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'matchgauge',
  fullName: 'Match Gauge Owner',
};

// tooltip 文案唯一挂在 composer 的 MatchGauge 上（admin-shell.json composer.matchTitle）。
const JD_MATCH_TOOLTIP = 'match against the job description';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin /drafts · the "match" gauge must depend on the job, not lie about it', () => {
  test.beforeAll(async ({ playwright }) => { await seed(playwright); });

  test('the same résumé applied to a different job must not keep the identical "match" score',
    gaugeDependsOnJob);
});

// gaugeDependsOnJob —— 打开 composer，换掉这份简历投的岗位（company+role），断言那个自称
// "match against the job description" 的数不能在 JD 变了之后一动不动。
async function gaugeDependsOnJob({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'drafts');
  await expect(page.getByTestId('draft-card')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /open composer/i }).first().click();

  const composer = page.getByTestId('resume-composer');
  await expect(composer).toBeVisible({ timeout: 5_000 });

  // 投一个**跟这份简历高度相关**的岗位（简历里有 "retrieval"、"backend"）。真实 draft 就是为某个
  // 具体岗位定制的，所以简历必然覆盖它 —— match 该高。summary/skills/experience/cover 一字不动。
  await composer.getByTestId('composer-company').fill('Anthropic');
  await composer.getByTestId('composer-role').fill('Backend retrieval engineer');
  await expect(composer.getByTestId('composer-role')).toHaveValue('Backend retrieval engineer');
  const before = await matchGaugeState(composer);
  expect(before.claimsJd, 'the gauge claims "match … against the job description"').toBe(true);
  expect(
    Number.isFinite(before.value),
    `expected a numeric match score in the gauge, read "${before.raw}"`,
  ).toBe(true);

  // 只换**投的岗位** —— 换成一个跟简历毫不相关的（Barista）。简历一字不动。
  await composer.getByTestId('composer-company').fill('Blue Bottle Coffee');
  await composer.getByTestId('composer-role').fill('Barista, morning shift');
  await expect(composer.getByTestId('composer-role')).toHaveValue('Barista, morning shift');

  const after = await matchGaugeState(composer);

  // 说谎 = 顶着 "match against the job description" 的数，在岗位换了之后值没变。
  // 诚实收尾任一即绿：那条 JD tooltip 没了（删表/改标 → claimsJd=false）；或数字跟着岗位动了。
  const stillLies = before.claimsJd && after.claimsJd && after.value === before.value;
  expect(
    stillLies,
    'the "match / 100" gauge kept the identical value after the applied-for job changed while still '
    + 'claiming "match against the job description" — draft-model.ts confidenceScore scores a fixed '
    + 'buzzword list over summary/skills/experience/cover and never reads company/role/JD '
    + `(before=${before.value}, after=${after.value})`,
  ).toBe(false);
}

// matchGaugeState —— 读 composer 顶栏 match 表：是否还顶着 JD tooltip + 表里那个整数。
// tooltip 不在了（删表/改标）→ claimsJd=false，诚实。
async function matchGaugeState(
  composer: Locator,
): Promise<{ claimsJd: boolean; value: number; raw: string }> {
  const gauge = composer.getByTitle(JD_MATCH_TOOLTIP);
  if (await gauge.count() === 0) return { claimsJd: false, value: NaN, raw: '' };
  const raw = (await gauge.first().innerText()).trim();
  const m = raw.match(/\d+/);
  return { claimsJd: true, value: m ? Number(m[0]) : NaN, raw };
}

// seed —— claim 一个 fresh owner，再经 MCP 落一份真 resume draft（列表里能点开 composer）。
async function seed(playwright: Playwright): Promise<void> {
  await claimFreshOwner(playwright, OWNER);
  const request = await playwright.request.newContext();
  await seedDraft(request);
  await request.dispose();
}

async function seedDraft(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'match-gauge-seed');
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Match Gauge Board', config: { company: 'anthropic' },
  });
  const { jobs } = await jobsFetchNew(request, token, sid, src.id);
  if (jobs.length === 0) throw new Error('mock job board returned 0 jobs');
  await resumeDraft(request, token, sid, jobs[0]!.cache_id, sampleResumeContent());
}
