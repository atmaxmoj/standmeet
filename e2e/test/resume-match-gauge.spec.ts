// resume-match-gauge.spec.ts -- the "match NN / 100" gauge at the top of the résumé
// composer must **genuinely** depend on the JD, and must not carry a "match against the
// job description" tooltip while knowing nothing about the JD at all.
//
// rot-A2 (HIGH): this number is confidenceScore (draft-model.ts:143) =
// min(0.98, 0.5 + hits*0.03), where hits counts how many times a **hardcoded** list of
// buzzwords (retrieval/eval/evaluation/llm/rag/brain/lucerna/launch, DEFAULT_KEYWORDS
// l.157) appears across summary+skills+experience+coverLetter, starting from a 50%
// floor. It **never reads** which job this résumé is being applied to -- the draft's job
// context is only company+role, and DraftModel has **no JD field at all**. So the same
// résumé applied to any job gets **the exact same number every time**, yet it sits right
// next to Send, carrying the tooltip "match against the job description". The owner uses
// it to decide whether to actually submit an application.
//
// RED criterion (chosen as the contract an owner would defend -- see the note at the end
// of this file):
//   Open the composer, read the match number once; change the job **this résumé is
//   applied to** (the header panel's company+role, the only job context the draft
//   carries) to a completely different job, without touching the résumé itself; read the
//   number again.
//   "Lying" = the number, carrying the "match against the job description" tooltip,
//   **doesn't move at all** after the JD changed.
//   Honest resolutions (either one is green): the number moves with the job (wired to a
//   real JD-based score) / or that JD tooltip is gone (the gauge removed or relabeled).
// Current code: company+role never enters confidenceScore's scoring text at all -> the
// two reads are necessarily equal -> RED.

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

// The tooltip copy lives in exactly one place, the composer's MatchGauge
// (admin-shell.json composer.matchTitle).
const JD_MATCH_TOOLTIP = 'match against the job description';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin /drafts · the "match" gauge must depend on the job, not lie about it', () => {
  test.beforeAll(async ({ playwright }) => { await seed(playwright); });

  test('the same résumé applied to a different job must not keep the identical "match" score',
    gaugeDependsOnJob);

  test('the gauge BAR renders the value it sits next to, and moves with it', gaugeBarRendersValue);
});

// gaugeBarRendersValue -- the number being correct doesn't mean the **bar** is correct.
//
// While manually driving this module, `match 55 / 100` was read out, while the bar to
// its left was **completely blank**. Two independent causes, and missing either one
// still hides the bar:
//   1. The fill ratio used to be written as a string-concatenated Tailwind arbitrary
//      value -> generates zero CSS at all (fixed separately).
//   2. `MatchGaugeBar` only attaches `.sm-fill`, and `.sm-fill` **only has width**;
//      height and color live in `.sm-session-strip-gauge-fill`, which this composer
//      instance is missing -> the box has zero height and no fill color.
// So fixing only one of the two still leaves the screen showing nothing -- which is
// exactly why this went unnoticed for so long.
//
// The criterion is **geometric**, not textual: reading innerText can't tell "drawn"
// apart from "squashed to zero" (see [[text-assertion-cannot-see-layout]]). And it
// asserts two things:
//   - the width at this instant genuinely reflects the ratio (a bar hardcoded to 50%
//     could still fake "having a width")
//   - once the job changes and the value changes, the width **changes with it** (this
//     is what keeps the assertion from being able to pass vacuously every time)
async function gaugeBarRendersValue({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'drafts');
  await expect(page.getByTestId('draft-card')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /open composer/i }).first().click();

  const composer = page.getByTestId('resume-composer');
  await expect(composer).toBeVisible({ timeout: 5_000 });

  await composer.getByTestId('composer-company').fill('Anthropic');
  await composer.getByTestId('composer-role').fill('Backend retrieval engineer');
  await expect(composer.getByTestId('composer-role')).toHaveValue('Backend retrieval engineer');
  await expectBarMatchesNumber(page);
  const high = await gaugeGeometry(page);

  expect(high.fillHeight, 'the gauge fill has no height — it is not drawn at all').toBeGreaterThan(0);

  // Switching to a job unrelated to the résumé -> the value must drop to its floor; the
  // bar must shrink along with it.
  await composer.getByTestId('composer-company').fill('Blue Bottle Coffee');
  await composer.getByTestId('composer-role').fill('Barista, morning shift');
  await expect(composer.getByTestId('composer-role')).toHaveValue('Barista, morning shift');
  await expectBarMatchesNumber(page);
  const low = await gaugeGeometry(page);

  expect(low.value, 'the number should drop for an unrelated job').toBeLessThan(high.value);
  expect(
    low.fillWidth,
    `the number moved ${high.value}→${low.value} but the bar stayed ${low.fillWidth}px `
    + `(was ${high.fillWidth}px) — the bar is decoration, not a reading`,
  ).toBeLessThan(high.fillWidth);
}

// expectBarMatchesNumber -- the bar's width must be at the same ratio as the number
// shown next to it.
//
// Uses `expect.poll` rather than a sleep: this bar has `transition: width .3s`; the
// first version of this test measured it directly, catching **a mid-animation frame**
// (the number read 79 while the bar was at 44%), which made the assertion complain about
// a defect that didn't exist. poll keeps retrying until the transition settles;
// **and if it never reaches that ratio, this still goes red** -- the wait doesn't weaken
// the assertion into something that always passes.
async function expectBarMatchesNumber(page: Page): Promise<void> {
  await expect.poll(async () => {
    const g = await gaugeGeometry(page);
    return Math.abs(g.fillRatio - g.value / 100) < 0.08;
  }, {
    timeout: 5_000,
    message: 'the bar never settled at the fraction the number claims',
  }).toBe(true);
}

// gaugeGeometry -- the actual boxes for the track and fill, plus the number on the
// gauge. Takes a single snapshot, no waiting.
async function gaugeGeometry(page: Page): Promise<{
  value: number; fillWidth: number; fillHeight: number; fillRatio: number;
}> {
  const track = await page.getByTestId('composer-match-track').boundingBox();
  const fill = await page.getByTestId('composer-match-fill').boundingBox();
  const raw = (await page.getByTitle(JD_MATCH_TOOLTIP).first().innerText()).trim();
  const m = raw.match(/\d+/);
  // boundingBox() returns null for a zero-size element -- that IS "not drawn", so it's
  // recorded as 0 instead of throwing somewhere else.
  return {
    value: m ? Number(m[0]) : NaN,
    fillWidth: fill?.width ?? 0,
    fillHeight: fill?.height ?? 0,
    fillRatio: (fill?.width ?? 0) / (track?.width ?? 1),
  };
}

// gaugeDependsOnJob -- opens the composer, swaps the job this résumé is applied to
// (company+role), and asserts the number that claims to be "match against the job
// description" can't stay put after the JD changes.
async function gaugeDependsOnJob({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'drafts');
  await expect(page.getByTestId('draft-card')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /open composer/i }).first().click();

  const composer = page.getByTestId('resume-composer');
  await expect(composer).toBeVisible({ timeout: 5_000 });

  // Applies to a job that's **highly relevant to this résumé** ("retrieval", "backend"
  // both appear in it). A real draft is always tailored to some specific job, so the
  // résumé necessarily covers it -- the match score should be high.
  // summary/skills/experience/cover are left untouched.
  await composer.getByTestId('composer-company').fill('Anthropic');
  await composer.getByTestId('composer-role').fill('Backend retrieval engineer');
  await expect(composer.getByTestId('composer-role')).toHaveValue('Backend retrieval engineer');
  const before = await matchGaugeState(composer);
  expect(before.claimsJd, 'the gauge claims "match … against the job description"').toBe(true);
  expect(
    Number.isFinite(before.value),
    `expected a numeric match score in the gauge, read "${before.raw}"`,
  ).toBe(true);

  // Changes only **the job applied to** -- swaps it for one entirely unrelated to the
  // résumé (Barista). The résumé itself is untouched.
  await composer.getByTestId('composer-company').fill('Blue Bottle Coffee');
  await composer.getByTestId('composer-role').fill('Barista, morning shift');
  await expect(composer.getByTestId('composer-role')).toHaveValue('Barista, morning shift');

  const after = await matchGaugeState(composer);

  // Lying = the number carrying "match against the job description" keeps the same
  // value after the job changed.
  // Either honest resolution is green: the JD tooltip is gone (removed/relabeled ->
  // claimsJd=false); or the number moved with the job.
  const stillLies = before.claimsJd && after.claimsJd && after.value === before.value;
  expect(
    stillLies,
    'the "match / 100" gauge kept the identical value after the applied-for job changed while still '
    + 'claiming "match against the job description" — draft-model.ts confidenceScore scores a fixed '
    + 'buzzword list over summary/skills/experience/cover and never reads company/role/JD '
    + `(before=${before.value}, after=${after.value})`,
  ).toBe(false);
}

// matchGaugeState -- reads the composer's top-bar match gauge: whether it still carries
// the JD tooltip, plus the integer it displays.
// If the tooltip is gone (removed/relabeled) -> claimsJd=false, which is honest.
async function matchGaugeState(
  composer: Locator,
): Promise<{ claimsJd: boolean; value: number; raw: string }> {
  const gauge = composer.getByTitle(JD_MATCH_TOOLTIP);
  if (await gauge.count() === 0) return { claimsJd: false, value: NaN, raw: '' };
  const raw = (await gauge.first().innerText()).trim();
  const m = raw.match(/\d+/);
  return { claimsJd: true, value: m ? Number(m[0]) : NaN, raw };
}

// seed -- claims a fresh owner, then writes a real resume draft through MCP (so the
// composer can be opened from the list).
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
