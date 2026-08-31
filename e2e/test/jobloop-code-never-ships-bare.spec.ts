// jobloop-code-never-ships-bare.spec.ts —— job loop 自动签出的码必须带着招聘语境出门。
//
// 缺陷（真实环境发现 2026-08-30）：`jobsuc/repo_applications.go` 的 `recruiterBriefing`
// 在 `snap.Title == ""` 时返回 `""`，于是 `InlinePrompt` 是空的。而每码提示词的解析链是
// `inline_prompt > prompt_id > 空` —— 中间那一档从来没人填。所以招聘官扫了简历右上角的 QR
// 进来，落进的是**没有任何招聘语境**的默认人格，然后 agent 会照着产品定位笔记回答
// "这不是一个适合找工作的人设" —— 在 flagship 那条路上，这是最坏的一种失败。
//
// 不变式：**job loop 签出的码不允许解析到空提示词**。这在签发时刻就判得出来，
// 判不过就该退回，而不是放一个哑码出门。
//
// 判据：不断"persona 非空"就完事 —— 默认人格也非空，那是个 non-unique signal。
// 要断的是这个码拿到的人格**和裸码不一样**，且确实建立了"对方在评估我这个候选人"这件事。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource, mockSetDay, MOCK_UNTITLED_DAY2 } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'jobloop@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'jobloop',
  fullName: 'Jo Loop',
};

// personaFor —— 招聘官那条真实路径：拿明文码开一个 visitor session，读它拿到的人格。
async function personaFor(request: APIRequestContext, code: string): Promise<string> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    headers: { 'Content-Type': 'application/json' },
    data: { mode: 'code', code, visitor_name: 'Recruiter Bob' },
  });
  if (res.status() !== 200) throw new Error(`sessions: ${res.status()}`);
  return (await res.json() as { system_prompt_persona: string }).system_prompt_persona;
}

// 一次 commit 要走完 fetch → draft → 渲染 PDF → 发码，默认 30s 不够。
test.describe.configure({ timeout: 180_000 });
test.describe('job loop · an auto-issued code always carries the hiring frame', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await mockSetDay(request, 'greenhouse', 1);
    await request.dispose();
  });

  test('a normal application: the issued code resolves to the hiring frame, not the default persona',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'jobloop-bare-spec');
      const sid = await initMCP(request, token);

      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const job = fetched.jobs.find((j) => j.title !== '');
      expect(job, 'the day-1 fixture must have at least one titled job').toBeDefined();

      const drafted = await resumeDraft(
        request, token, sid, job!.cache_id, sampleResumeContent(),
      );
      const committed = await applicationsCommit(request, token, sid, drafted.view.draft_id);
      const persona = await personaFor(request, committed.view.access_code);

      // ① 建立了"你在评估我这个候选人"这件事 —— 这正是 owner 写在 hiring prompt 里的东西，
      //    而自动签的码今天拿不到它（只有一句硬编码的角色名）。
      expect(persona).toMatch(/candidate|job application|evaluating/i);
      // ② 明确挡住那句最坏的回答的来源：招聘语境下不能把产品定位笔记读成关于 owner 的判断。
      //    （断的不再是 "actively looking" —— 那句**替 owner 宣布了一件事**，
      //    已经从 builtin 里拿掉了；默认值只该建立通道，不该断言这个人的状态。）
      expect(persona).toMatch(/marketing copy describes who the product serves/i);
      //    以及那条反编造的硬规矩。
      expect(persona).toMatch(/never invent an employer/i);
    });

  test('a job the board served with no title: the code still carries the frame',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'jobloop-untitled-spec');
      const sid = await initMCP(request, token);

      // 替身换到 day2 —— 那一天里有一条 title 为空的行（见 mock-stack/job-board/day2.go）。
      await mockSetDay(request, 'greenhouse', 2);
      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Airbnb Day2', config: { company: 'airbnb' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const untitled = fetched.jobs.find((j) => j.external_id === MOCK_UNTITLED_DAY2);
      expect(untitled, 'the untitled day-2 row must reach the cache').toBeDefined();
      expect(untitled!.title).toBe('');

      const drafted = await resumeDraft(
        request, token, sid, untitled!.cache_id, sampleResumeContent(),
      );
      const committed = await applicationsCommit(request, token, sid, drafted.view.draft_id);
      const persona = await personaFor(request, committed.view.access_code);

      // 空标题不是"少一行字"，今天它让整段 briefing 变成空串 —— 码就哑了。
      expect(persona).toMatch(/candidate|job application|evaluating/i);
      expect(persona).toMatch(/marketing copy describes who the product serves/i);
    });

  // ── 两份申请，各带各的 ─────────────────────────────────────────
  test('two applications issue two codes, and each carries its own role',
    ({ request }) => twoApplicationsCarryTheirOwnRole(request));

  // ── 码发出去之后，改 hiring prompt 还救得回来吗 ────────────────
  //
  // RoleSnapshot 在 **session 颁发时**拍，不是发码时（`entity/role_snapshot.go:8`：
  // "Owner 改 role / prompt / skill → 不影响在跑 session；只影响后续新 session"）。
  // 这一条正是 `prompt_id` 该赢过 `inline_prompt` 的理由：招聘官可能几个月后才扫码，
  // 而那时 owner 早就把 hiring prompt 打磨过好几轮 —— 冻结在码上的那段文字享受不到。
  test('improving the hiring prompt reaches codes that were already issued',
    ({ request }) => livePromptReachesIssuedCodes(request));
});

// ── 上面两条的正文，抽出来只为满足 max-lines-per-function ──────────

async function twoApplicationsCarryTheirOwnRole(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'jobloop-two-spec');
  const sid = await initMCP(request, token);

  await mockSetDay(request, 'greenhouse', 1);
  const source = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Airbnb Two', config: { company: 'airbnb' },
  });
  const fetched = await jobsFetchNew(request, token, sid, source.id);
  const titled = fetched.jobs.filter((j) => j.title !== '');
  expect(titled.length, 'need two distinct titled jobs').toBeGreaterThanOrEqual(2);

  const codes: string[] = [];
  for (const job of titled.slice(0, 2)) {
    const d = await resumeDraft(request, token, sid, job.cache_id, sampleResumeContent());
    const c = await applicationsCommit(request, token, sid, d.view.draft_id);
    codes.push(c.view.access_code);
  }
  // 两张不同的码 —— 一张码复用给两份申请的话，招聘官 A 打开会看到冲着 B 的语境。
  expect(codes[0]).not.toBe(codes[1]);
  const p0 = await personaFor(request, codes[0]!);
  const p1 = await personaFor(request, codes[1]!);
  expect(p0).toMatch(/candidate|job application|evaluating/i);
  expect(p1).toMatch(/candidate|job application|evaluating/i);
  // 各自说的是各自那个职位。
  expect(p0).toContain(titled[0]!.title);
  expect(p1).toContain(titled[1]!.title);
}

async function livePromptReachesIssuedCodes(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'jobloop-live-prompt-spec');
  const sid = await initMCP(request, token);

  await mockSetDay(request, 'greenhouse', 1);
  const source = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Airbnb Live', config: { company: 'airbnb' },
  });
  const fetched = await jobsFetchNew(request, token, sid, source.id);
  const job = fetched.jobs.find((j) => j.title !== '')!;
  const drafted = await resumeDraft(request, token, sid, job.cache_id, sampleResumeContent());
  const committed = await applicationsCommit(request, token, sid, drafted.view.draft_id);

  // 码已经发出去了。现在 owner 改 hiring prompt。
  const marker = 'PROMPT-EDITED-AFTER-THE-CODE-WAS-ISSUED';
  // prompt_list 回的是**裸数组**，路径带尾杠；更新走 PUT 且 name + body 都必填。
  const prompts = await request.get(`${BACKEND}/api/admin/prompts/`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(prompts.status()).toBe(200);
  const list = await prompts.json() as { id: string; name: string; body: string }[];
  const hiring = list.find((p) => p.name === 'hiring');
  expect(hiring, 'the hiring prompt must exist for a job-loop code to point at it').toBeDefined();
  const upd = await request.put(`${BACKEND}/api/admin/prompts/${hiring!.id}`, {
    headers: { 'X-Csrftoken': csrf },
    data: { prompt_id: hiring!.id, name: hiring!.name, body: `${hiring!.body}\n\n${marker}` },
  });
  expect(upd.status(), await upd.text()).toBe(200);

  // 招聘官现在才第一次打开那张码 —— 他该拿到改进后的版本。
  expect(await personaFor(request, committed.view.access_code)).toContain(marker);
}
