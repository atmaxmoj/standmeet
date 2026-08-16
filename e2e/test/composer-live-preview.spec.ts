// composer-live-preview.spec.ts —— end-to-end UI proof for the
// post-2026-05-28 ResumeComposer + DraftThumb + new <ResumePage>
// component (task 14 + 15).
//
// We seed a draft via MCP (resume.draft), open /admin/drafts, then:
//   1. assert the DraftThumb renders the canonical <ResumePage>
//      (data-testid="resume-page") inside the card
//   2. open the composer, assert the preview pane stacks 2 ResumePage
//      instances when cover_letter is non-empty
//   3. assert the new 'social' + 'custom' panels are reachable (8 panels)
//   4. typing into composer-name updates the live preview (proves the
//      DraftModel → ResumeContent adapter is wired both ways)

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin /drafts · composer live preview wires ResumePage', () => {
  test.beforeAll(async ({ playwright }) => { await seedDraft(playwright); });

  test('DraftThumb renders a scaled <ResumePage> inside each card',
    async ({ adminPage }) => {
      await openDrafts(adminPage);
      await expect(adminPage.getByTestId('draft-thumb').first())
        .toBeVisible({ timeout: 5_000 });
      // The thumb embeds the canonical ResumePage component — same
      // testid the composer + print route use.
      await expect(adminPage.getByTestId('draft-thumb').first()
        .getByTestId('resume-page')).toBeVisible();
    });

  test('composer preview stacks 2 ResumePage instances when cover letter is present',
    async ({ adminPage }) => {
      await openDrafts(adminPage);
      await adminPage.getByText('open composer →').first().click();
      const composer = adminPage.getByTestId('resume-composer');
      await expect(composer).toBeVisible();
      // The seeded draft (sampleResumeContent) ships a cover letter, so the
      // composer opens with 2 pages. Clearing the cover drops it to 1; refilling
      // brings page 2 back — proves the conditional page-2 wiring both ways.
      await expect(composer.getByTestId('resume-page')).toHaveCount(2);
      await composer.getByRole('button', { name: 'cover letter', exact: true }).click();
      await composer.getByTestId('composer-cover').fill('');
      await expect(composer.getByTestId('resume-page')).toHaveCount(1);
      await composer.getByTestId('composer-cover').fill('Dear team — this is the cover.');
      await expect(composer.getByTestId('resume-page')).toHaveCount(2);
    });

  test('composer has 8 panels including social + custom',
    async ({ adminPage }) => {
      await openDrafts(adminPage);
      await adminPage.getByText('open composer →').first().click();
      const composer = adminPage.getByTestId('resume-composer');
      for (const label of ['header', 'summary', 'skills', 'experience',
        'education', 'social', 'custom', 'cover letter']) {
        await expect(composer.getByRole('button', { name: label, exact: true }))
          .toBeVisible();
      }
    });

  test('typing in composer-name updates the live preview',
    async ({ adminPage }) => {
      await openDrafts(adminPage);
      await adminPage.getByText('open composer →').first().click();
      const composer = adminPage.getByTestId('resume-composer');
      await composer.getByTestId('composer-name').fill('Jordan Lee');
      // ResumePage lowercases the name; the preview (scoped inside the composer)
      // should reflect it. Scoped to the composer because the card underneath
      // renders the SAVED draft — typing here has not been saved yet.
      await expect(composer.getByTestId('resume-page').first()
        .getByText('jordan lee')).toBeVisible({ timeout: 2_000 });
    });

  // 卡片上那张缩略图画的必须是**这一份草稿**（F-E-20）。以前它画的是一份写死的假简历：
  // owner 的真名底下写着 Stanford 博士、Google Brain 任职,而且每张卡都是同一张图 ——
  // 在一个投简历的产品上,这是最坏的错法(扫一眼卡片就是 owner 判断"可以发了"的方式)。
  test('卡片上的缩略图画的是这份草稿自己的内容,不是一份样例',
    async ({ adminPage }) => {
      await openDrafts(adminPage);
      const thumbs = adminPage.getByTestId('draft-thumb');
      await expect(thumbs).toHaveCount(2, { timeout: 5_000 });
      const texts = await thumbs.allInnerTexts();
      // 两份草稿种的是两个人（Alice / Nadia）。**两张图都要各画各的** ——
      // 原来它们是同一份写死的文档,只有页眉那一条公司/职位不同。
      expect(texts.join('|'), '一张画的是 Alice 那份').toContain('alice anderson');
      expect(texts.join('|'), '另一张画的是 Nadia 那份').toContain('nadia noon');
      expect(texts[0], '两张缩略图不是同一份文档').not.toBe(texts[1]);
      expect(texts.join('|'), 'Alice 那份的经历也在图上').toContain('Acme');
    });

  // 空的段落连标题都不印（F-E-21）。这是要发给招聘方的文档,一个底下什么都没有的
  // `education` 读起来像"渲染坏了"或者"他没上过学",而不是"这一段不适用"。
  test('没有履历的草稿:空段落整段不出现,不是一个空标题',
    async ({ adminPage }) => {
      await openDrafts(adminPage);
      const empty = adminPage.getByTestId('draft-thumb')
        .filter({ hasText: 'nadia noon' }).first();
      await expect(empty).toBeVisible({ timeout: 5_000 });
      await expect(empty, '有 summary 的段落照常出现').toContainText('summary');
      const text = await empty.innerText();
      expect(text, '没有履历就不该印 experience 这个标题').not.toContain('experience');
      expect(text, '没有学历就不该印 education 这个标题').not.toContain('education');
    });
});

async function seedDraft(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'composer-spec-seed');
  const sid = await initMCP(request, token);
  const source = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Anthropic', config: { company: 'anthropic' },
  });
  const fetched = await jobsFetchNew(request, token, sid, source.id);
  await resumeDraft(
    request, token, sid, fetched.jobs[0]!.cache_id, sampleResumeContent(),
  );
  // 第二份草稿:**没有 works / educations**。这个实例上这不是极端情况而是常态 ——
  // owner 的履历只以散文形态活在语料里,`resume.draft` 拿不到带日期的条目,
  // 两次真实驱动交上来的都是空数组（F-E-22）。同一次 fetch 的另一条岗位:
  // 换个源再 fetch 一次拿到的是**空的**(那批岗位已经进过池子,跨源去重把它们挡掉了)。
  await resumeDraft(
    request, token, sid, fetched.jobs[1]!.cache_id, sampleResumeContent({
      identity: {
        name: 'Nadia Noon', email: 'nadia@example.com', phone: '',
        location_line: 'Toronto, ON', site: '',
      },
      works: [], educations: [], skills: [],
    }),
  );
  await request.dispose();
}

async function openDrafts(page: Page): Promise<void> {
  await gotoAdminSection(page, 'drafts');
  await page.waitForURL('**/admin/drafts');
}
