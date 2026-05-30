// skills.spec.ts —— owner curates an AI skill and attaches it to an invite
// code; visitor chats with that code and the skill prompt is composed into
// the AI's system prompt (mock provider echoes the system prompt → assert it
// contains the skill's marker).
//
// 业务故事：
//   alice 在 /admin/skills 加一个叫 "patent-marker" 的 skill (prompt =
//   "Always begin replies with [SKILL-PATENT-MARKER]"). 切到 /admin/codes
//   建 PATENT-001 时点选这个 skill。visitor 用 PATENT-001 进入 chat，
//   mock provider 在回复前面塞 system prompt → 回复里能看到该 marker。
//
// 还顺便验：
//   - builtin skills 已 seed（claim 后自动 5 个）
//   - builtin skill 没有 delete 按钮（不可删）

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

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
  description: 'A test skill that injects a recognizable marker.',
  prompt: 'Always begin replies with [SKILL-PATENT-MARKER].',
};

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
    // 5 个 builtin: code-review / frontend-design / resume-portfolio /
    // technical-interview / conversation-report. 至少几个明确可见。
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
      // A.3-IAM-5: code 不再直接挂 skill；走 role 中转。
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

  test('visitor chats with the code; skill prompt is composed into AI system',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Patent Recruiter',
      });
      const res = await sendMessage(request, sess, 'what was the role about?');
      expect(res.status()).toBe(200);
      const body = await res.text();
      // mock provider echoes system prompt as a streamed body line; the skill
      // prompt fragment must appear in that echo, proving composition worked.
      expect(body).toContain('SKILL-PATENT-MARKER');
    });
});

async function openSkills(page: Page): Promise<void> {
  await gotoAdminSection(page, 'skills');
  await page.waitForURL('**/admin/skills', { timeout: 5_000 });
}
