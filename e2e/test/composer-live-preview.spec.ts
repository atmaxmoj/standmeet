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

  // The thumbnail on a card must render **this specific draft** (F-E-20). It used to render a
  // hardcoded fake resume: the owner's real name, with a Stanford PhD and a Google Brain
  // position written underneath it, and every card showed the exact same image — on a product
  // for sending out resumes, this is the worst possible way to be wrong (glancing at the card is
  // how the owner judges "this is ready to send").
  test('卡片上的缩略图画的是这份草稿自己的内容,不是一份样例',
    async ({ adminPage }) => {
      await openDrafts(adminPage);
      const thumbs = adminPage.getByTestId('draft-thumb');
      await expect(thumbs).toHaveCount(2, { timeout: 5_000 });
      const texts = await thumbs.allInnerTexts();
      // The two seeded drafts are two different people (Alice / Nadia). **Each image must render
      // its own draft** — they used to be the same hardcoded document, with only the header's
      // company/role line differing.
      expect(texts.join('|'), '一张画的是 Alice 那份').toContain('alice anderson');
      expect(texts.join('|'), '另一张画的是 Nadia 那份').toContain('nadia noon');
      expect(texts[0], '两张缩略图不是同一份文档').not.toBe(texts[1]);
      expect(texts.join('|'), 'Alice 那份的经历也在图上').toContain('Acme');
    });

  // An empty section doesn't even print its heading (F-E-21). This is a document going out to a
  // recruiter, and an `education` heading with nothing under it reads as "the rendering is
  // broken" or "this person never went to school", not "this section doesn't apply".
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

// **Who fills it back in** once it's empty (F-E-22). The drafting step only recognizes dated
// entries in the corpus, and the owner's work history only lives in prose form — so this gap
// belongs to the owner. The product used to have nowhere to bridge that gap: the panel had
// neither a sentence explaining it nor an "add an entry" button — empty just stayed empty.
// Reuses the two drafts seeded by the previous group (same instance, runs after it in file
// order).
test.describe('履历空了之后谁来补', () => {
  test('履历空的时候:面板说清这一跳归谁,而且真的加得进去',
    async ({ adminPage }) => {
      await openDrafts(adminPage);
      // The second card (Nadia) is the draft with no work history.
      const card = adminPage.getByTestId('draft-thumb')
        .filter({ hasText: 'nadia noon' }).first();
      await expect(card).toBeVisible({ timeout: 5_000 });
      await adminPage.getByText('open composer →').nth(await indexOfNadia(adminPage)).click();
      const composer = adminPage.getByTestId('resume-composer');
      await composer.getByRole('button', { name: 'experience', exact: true }).click();

      const hint = composer.getByTestId('composer-exp-empty');
      await expect(hint, '空面板要说清为什么空、以及空着会怎样').toBeVisible();
      await expect(hint).toContainText('yours to write');
      await expect(hint, '还要说清留空的后果').toContainText('left out of the document');

      // Add an entry, fill it in, and it must show up in the preview — "saying so" isn't
      // enough, it has to **actually work**.
      await composer.getByTestId('composer-exp-add').click();
      await composer.getByLabel('org').first().fill('Lucerna');
      await expect(
        composer.getByTestId('resume-page').first(),
        '刚加的那条要出现在预览里',
      ).toContainText('Lucerna', { timeout: 3_000 });
    });
});

// indexOfNadia — Nadia's card's position in the list. Cards are newest-first, and the two drafts
// were created in the same seed, so the order shouldn't be guessed at.
async function indexOfNadia(page: Page): Promise<number> {
  const texts = await page.getByTestId('draft-thumb').allInnerTexts();
  return texts.findIndex((t) => t.includes('nadia noon'));
}

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
  // The second draft: **no works / educations**. On this instance that isn't an edge case, it's
  // the norm — the owner's work history only lives in the corpus as prose, `resume.draft` can't
  // find any dated entries, and two real runs both came back with empty arrays (F-E-22). The
  // other job from the same fetch: fetching again from a different source comes back **empty**
  // (those jobs already entered the pool, and cross-source dedup filters them out).
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
