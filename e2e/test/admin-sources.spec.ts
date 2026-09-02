// admin-sources.spec.ts —— admin /sources lists the owner's real job sources
// (#51). Sources are registered via MCP jobs.register_source; the admin section
// is read-only and now fetches GET /api/admin/job-sources/ (was a stub).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';

const OWNER = {
  email: 'sources@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sources',
  fullName: 'Sources Owner',
};
const LABEL = 'Sources Test Board';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin sources list', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('empty state when no source is registered',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      await expect(adminPage.getByText(/no sources registered/i)).toBeVisible();
    });

  test('no dead "+board"/"+rss" add buttons — sources are MCP-registered (F-E-1)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      // The old header buttons opened no form and contradicted the page's own copy. Removed —
      // the page directs to the jobs.register_source MCP tool instead.
      await expect(adminPage.getByRole('button', { name: /\+\s*board/i })).toHaveCount(0);
      await expect(adminPage.getByRole('button', { name: /rss|scraper/i })).toHaveCount(0);
      await expect(adminPage.getByText(/jobs\.register_source/i).first()).toBeVisible();
    });

  test('a registered source appears in the list',
    async ({ request, adminPage }) => {
      await seedSource(request);
      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      await expect(adminPage.getByTestId('sources-list')).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByText(LABEL)).toBeVisible();
    });
  // What this page has to answer is "is my source still alive". A source that **was
  // fetched but has failed every time** used to print the same `never fetched` line as a
  // source that **has never been touched** (F-E-18, all three rows looked like that in
  // the real environment). Force a real failure with a workable source that has a bad
  // token: it registers fine, but fetching data is guaranteed to fail.
  test('a source that was tried and failed does not read as "never fetched"',
    async ({ request, adminPage }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'sources-failing');
      const sid = await initMCP(request, token);
      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'workable',
        label: 'Failing Board',
        config: { company: 'acme', api_token: 'not-the-token' },
      });
      await jobsFetchNew(request, token, sid, src.id);

      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      const state = adminPage.getByTestId(`source-state-${src.id}`);
      await expect(state).toBeVisible({ timeout: 5_000 });
      const text = await state.innerText();
      // Grab the text first, then assert: `.not.toContainText` also passes when the
      // element hasn't appeared yet ([[negated-assertion-passes-while-absent]]).
      expect(text, '试过就不该说「从没取过」').not.toMatch(/never fetched/i);
      expect(text, '要说出上次试过、失败了').toMatch(/failed/i);
      expect(text, '要带上原因，owner 才知道下一步做什么').toMatch(/credential|token/i);
      // **A human-facing sentence, not the whole error chain** (UX-77): the first two
      // segments of the chain are the source uuid and an internal verb, which would wrap
      // this row into three lines, and the owner only needs the last clause. The full
      // chain is left for the owner's AI (`failed_sources[].reason`) and the logs.
      expect(text, '不该把源的 uuid 摆在屏幕上').not.toContain(src.id);
      expect(text, '不该出现内部动词').not.toMatch(/fetch source|fetch workable/i);
      expect(text, '不该出现上游 URL').not.toMatch(/https?:\/\//);
    });

  // **One sentence covers two completely different situations** (F-E-28, hit in prod):
  // `fetch/http.go` lumps every non-2xx into a single `ErrUpstream`, so a 301 (the board
  // moved) and a 404 (this board never existed) get the same sentence on
  // `/admin/sources` — "the board turned the request away — it may have moved".
  //
  // For a 404, that sentence is **false**, and it points the owner at the wrong next
  // step: they'll go looking for a new address, when what they actually need to do is
  // fix a misspelled company slug (or delete the source). The whole classification
  // table's discipline is "every sentence names the next step" — this one doesn't, for
  // this class ([[collapsed-error-class-kills-its-own-branch]]).
  test('a board that does not exist is not reported as one that moved',
    async ({ request, adminPage }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'sources-404');
      const sid = await initMCP(request, token);
      // The stand-in matches real Greenhouse: no such board returns 404 (verified against
      // the real board on the spot).
      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Ghost Board', config: { company: 'no-such-company-here' },
      });
      const out = await jobsFetchNew(request, token, sid, src.id);
      expect(
        (out.failed_sources ?? []).map((f) => f.source_id),
        'precondition: 这个源必须真的取失败了，否则下面判的是空气',
      ).toContain(src.id);

      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      const state = adminPage.getByTestId(`source-state-${src.id}`);
      await expect(state).toBeVisible({ timeout: 5_000 });
      expectMissingBoardSentence(await state.innerText(), src.id);
    });
});

// expectMissingBoardSentence — what the "there's no board at this address" row should look like.
function expectMissingBoardSentence(text: string, srcID: string): void {
  expect(text, '要说出上次试过、失败了').toMatch(/failed/i);
  expect(
    text,
    '404 不是"搬家了"：板子没搬，它压根不存在。这句话会把 owner 送去找新地址',
  ).not.toMatch(/moved/i);
  expect(
    text,
    '要指出真正的下一步：这个地址上没有板子，去改源的设置',
  ).toMatch(/no such board|doesn't exist|does not exist|check the .*(address|settings|company)/i);
  // The human-facing row's discipline still applies (UX-77).
  expect(text, '不该把源的 uuid 摆在屏幕上').not.toContain(srcID);
  expect(text, '不该出现上游 URL').not.toMatch(/https?:\/\//);
  expect(text, '不该出现状态码').not.toMatch(/\b404\b/);
}

async function seedSource(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'sources-seed');
  const sid = await initMCP(request, token);
  await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: LABEL, config: { company: 'airbnb' },
  });
}
