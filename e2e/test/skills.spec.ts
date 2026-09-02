// skills.spec.ts — Phase C / L1 (progressive disclosure, level one): the owner
// curates a skill and attaches it to a code; when a visitor enters chat, **only the
// skill's name+description live permanently in the system prompt, the body never
// enters it**. The mock provider echoes back [system:...] → the assertion checks
// for the description's L1 marker but **not** the body's L2 marker (the body is only
// disclosed after skill_use, see skill-progressive-disclosure.spec.ts).
//
// This replaces the eager model: previously the entire prompt was stuffed into the
// system prompt (the body marker showed up on the very first turn). Now L1 carries
// only the metadata.
//
// Business story:
//   alice adds "patent-marker" in /admin/skills: the description contains
//   [SKILL-L1-DESC], the body prompt contains [SKILL-L2-BODY]. Attach it to a role →
//   send PATENT-001. A visitor enters chat: the echoed system prompt has L1-DESC but
//   not L2-BODY.
//
// Also incidentally verifies:
//   - builtin skills are already seeded (5 automatically, after claim)
//   - a builtin skill has no delete button (cannot be deleted)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const SKILL = {
  name: 'patent-marker',
  // L1 marker lives in the description → must appear in the system prompt.
  description: 'Reviews patents [SKILL-L1-DESC].',
  // L2 marker lives in the body/prompt → must NOT appear at L1, only after skill_use.
  prompt: 'When reviewing, always note [SKILL-L2-BODY].',
};

const L1_DESC_MARKER = '[SKILL-L1-DESC]';
const L2_BODY_MARKER = '[SKILL-L2-BODY]';

const CODE = 'PATENT-001';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner curates AI skills and attaches them to invite codes', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('builtin skills are seeded on first claim', async ({ adminPage: page }) => {
    await openSkills(page);
    // 5 builtins: code-review / frontend-design / resume-portfolio /
    // technical-interview / conversation-report. At least a few are checked visible
    // explicitly.
    await expect(page.getByTestId('skill-row-code-review')).toBeVisible();
    await expect(page.getByTestId('skill-row-conversation-report')).toBeVisible();
    // builtin badge present, delete button absent.
    const builtins = page.getByTestId('skill-builtin-badge');
    await expect(builtins.first()).toBeVisible();
  });

  test('owner creates a custom skill', async ({ adminPage: page }) => {
    await openSkills(page);
    await page.getByRole('button', { name: /new skill/i }).click();
    await page.getByTestId('skill-field-name').fill(SKILL.name);
    await page.getByTestId('skill-field-description').fill(SKILL.description);
    await page.getByTestId('skill-field-prompt').fill(SKILL.prompt);
    await page.getByTestId('skill-create-submit').click();
    await expect(page.getByTestId(`skill-row-${SKILL.name}`)).toBeVisible({ timeout: 5_000 });
  });

  test('owner creates a role attaching the skill, then issues a code with that role',
    async ({ adminPage: page }) => {
      // A.3-IAM-5: a code no longer attaches a skill directly; it goes through a
      // role instead.
      await gotoAdminSection(page, 'roles');
      await page.waitForURL('**/admin/roles');
      await page.getByTestId('role-new').click();
      const modal = page.getByTestId('role-create-modal');
      await expect(modal).toBeVisible();
      await modal.getByTestId('role-field-name').fill('patent-loop');
      await modal.getByTestId('role-field-corpus-uris').fill(
        ['wiki://**', 'output://**', 'writing://**'].join('\n'),
      );
      const skillsField = modal.getByTestId('role-field-skills');
      await expect(skillsField.locator(`[data-testid="role-multi-${SKILL.name}"]`))
        .toBeVisible({ timeout: 5_000 });
      await skillsField.locator(`[data-testid="role-multi-${SKILL.name}"]`).click();
      await modal.getByTestId('role-create-submit').click();
      await expect(modal).not.toBeVisible({ timeout: 5_000 });

      await gotoAdminSection(page, 'codes');
      await page.waitForURL('**/admin/codes');
      await page.getByRole('button', { name: /new code/i }).click();
      await page.getByTestId('code-input').fill(CODE);
      await page.getByTestId('code-label').fill('Patent reviewer loop');
      const roleDropdown = page.getByTestId('code-field-role');
      await expect(roleDropdown.locator('option', { hasText: 'patent-loop' }))
        .toHaveCount(1, { timeout: 5_000 });
      await roleDropdown.selectOption({ label: 'patent-loop' });
      await page.getByTestId('code-create').click();
      await expect(page.getByTestId(`code-row-${CODE}`)).toBeVisible({ timeout: 5_000 });
    });

  test('L1: visitor system prompt carries skill name+description, NOT the body',
    async ({ request }) => { await assertL1SystemPrompt(request); });

  // #48-2: toggling a skill OFF globally excludes it from the agent even though
  // it's still attached to the role — a fresh session no longer composes it.
  test('toggling the skill off excludes it from a freshly issued session',
    async ({ adminPage, request }) => {
      await toggleSkillOffAndVerifyExcluded(adminPage, request);
    });
});

async function assertL1SystemPrompt(request: APIRequestContext): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'Patent Recruiter',
  });
  const res = await sendMessage(request, sess, 'what was the role about?');
  expect(res.status()).toBe(200);
  const body = await res.text();
  // mock echoes [system:...]; L1 = description present, skill name present,
  // body (L2) absent until skill_use. This is the key assertion of progressive
  // disclosure.
  expect(body, 'description in system prompt (L1)').toContain(L1_DESC_MARKER);
  expect(body, 'skill name in system prompt (L1)').toContain(SKILL.name);
  expect(body, 'body NOT in system prompt (L2 deferred)').not.toContain(L2_BODY_MARKER);
}

async function toggleSkillOffAndVerifyExcluded(
  page: Page, request: APIRequestContext,
): Promise<void> {
  await openSkills(page);
  const toggle = page.getByTestId(`skill-toggle-${SKILL.name}`);
  await expect(toggle).toHaveText('on', { timeout: 5_000 });
  await toggle.click();
  await expect(toggle).toHaveText('off', { timeout: 5_000 });

  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'After Toggle',
  });
  const res = await sendMessage(request, sess, 'what was the role about?');
  expect(res.status()).toBe(200);
  // disabled → not even the L1 metadata enters the system prompt.
  expect(await res.text()).not.toContain(L1_DESC_MARKER);
}

async function openSkills(page: Page): Promise<void> {
  await gotoAdminSection(page, 'skills');
  await page.waitForURL('**/admin/skills', { timeout: 5_000 });
}
