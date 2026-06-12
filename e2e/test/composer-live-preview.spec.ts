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
      // ResumePage lowercases the name; preview (scoped inside composer)
      // should reflect it. The thumb on the page beneath uses mockDraft
      // independently, so we scope to composer to avoid matching it.
      await expect(composer.getByTestId('resume-page').first()
        .getByText('jordan lee')).toBeVisible({ timeout: 2_000 });
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
  await request.dispose();
}

async function openDrafts(page: Page): Promise<void> {
  await gotoAdminSection(page, 'drafts');
  await page.waitForURL('**/admin/drafts');
}
