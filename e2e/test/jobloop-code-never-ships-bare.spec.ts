// jobloop-code-never-ships-bare.spec.ts -- a code the job loop auto-issues must carry
// the hiring context out into the world.
//
// Defect (found in a real environment 2026-08-30): `jobsuc/repo_applications.go`'s
// `recruiterBriefing` returns `""` whenever `snap.Title == ""`, leaving `InlinePrompt`
// empty. And each code's prompt resolution chain is `inline_prompt > prompt_id >
// empty` -- nobody ever filled that middle tier. So a recruiter scans the QR code in
// the corner of a resume, and lands in a default persona **carrying no hiring context
// whatsoever**; the agent then reads the product's positioning notes and answers
// "this isn't a persona built for job hunting" -- on the flagship path, this is the
// worst possible way to fail.
//
// Invariant: **a code the job loop issues must never resolve to an empty prompt.**
// This is checkable right at issuance time; a failing check should bounce the issuance,
// not let a mute code ship.
//
// Criterion: asserting "the persona is non-empty" and calling it done isn't enough --
// the default persona is non-empty too, making that a non-unique signal. What must be
// asserted is that the persona this code resolves to **differs from the bare code's**,
// and that it actually establishes "this person is evaluating me as a candidate".

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

// personaFor -- the recruiter's real path: open a visitor session with the plaintext
// code, and read the persona it comes back with.
async function personaFor(request: APIRequestContext, code: string): Promise<string> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    headers: { 'Content-Type': 'application/json' },
    data: { mode: 'code', code, visitor_name: 'Recruiter Bob' },
  });
  if (res.status() !== 200) throw new Error(`sessions: ${res.status()}`);
  return (await res.json() as { system_prompt_persona: string }).system_prompt_persona;
}

// One commit walks the whole fetch -> draft -> render PDF -> issue code chain; the
// default 30s isn't enough.
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

      // 1) Establishes "you're evaluating me as a candidate" -- exactly what the owner
      //    wrote into the hiring prompt, and something an auto-issued code doesn't get
      //    today (only a hardcoded role name).
      expect(persona).toMatch(/candidate|job application|evaluating/i);
      // 2) Explicitly blocks the source of the worst possible answer: in a hiring
      //    context, the product's positioning notes must not be read as a judgment
      //    about the owner. (No longer asserting "actively looking" -- that line
      //    **announced a fact on the owner's behalf**, and has been removed from the
      //    builtin; a default should only establish the channel, not assert this
      //    person's status.)
      expect(persona).toMatch(/marketing copy describes who the product serves/i);
      //    ...plus the hard rule against inventing facts.
      expect(persona).toMatch(/never invent an employer/i);
    });

  test('a job the board served with no title: the code still carries the frame',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'jobloop-untitled-spec');
      const sid = await initMCP(request, token);

      // Switch the mock to day 2 -- that day has one row with an empty title (see
      // mock-stack/job-board/day2.go).
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

      // An empty title isn't "missing one line of text" -- today it turns the whole
      // briefing into an empty string, and the code goes mute.
      expect(persona).toMatch(/candidate|job application|evaluating/i);
      expect(persona).toMatch(/marketing copy describes who the product serves/i);
    });

  // -- two applications, each carrying its own -----------------------------
  test('two applications issue two codes, and each carries its own role',
    ({ request }) => twoApplicationsCarryTheirOwnRole(request));

  // -- once a code has shipped, does improving the hiring prompt still reach it? ------
  //
  // RoleSnapshot is captured **when the session is issued**, not when the code is
  // issued (`entity/role_snapshot.go:8`: "the owner changing role / prompt / skill
  // does not affect a running session; only affects future new sessions"). This is
  // exactly why `prompt_id` needs to outrank `inline_prompt`: a recruiter might not
  // scan the code for months, by which point the owner has already refined the hiring
  // prompt through several rounds -- text frozen onto the code at issuance time would
  // never see any of that.
  test('improving the hiring prompt reaches codes that were already issued',
    ({ request }) => livePromptReachesIssuedCodes(request));
});

// -- bodies of the two tests above, extracted only to satisfy max-lines-per-function --

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
  // Two distinct codes -- if one code were reused across two applications, recruiter A
  // opening it would see context aimed at B.
  expect(codes[0]).not.toBe(codes[1]);
  const p0 = await personaFor(request, codes[0]!);
  const p1 = await personaFor(request, codes[1]!);
  expect(p0).toMatch(/candidate|job application|evaluating/i);
  expect(p1).toMatch(/candidate|job application|evaluating/i);
  // Each names its own job.
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

  // The code has already shipped. Now the owner edits the hiring prompt.
  const marker = 'PROMPT-EDITED-AFTER-THE-CODE-WAS-ISSUED';
  // prompt_list returns a **bare array**, and its path has a trailing slash; updating
  // goes through PUT, and both name + body are required.
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

  // The recruiter opens the code for the first time only now -- they should get the
  // improved version.
  expect(await personaFor(request, committed.view.access_code)).toContain(marker);
}
