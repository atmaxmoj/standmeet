// admin-system-upgrade.spec.ts —— the "upgrade" block on /admin/system.
//
// What it replaces is a **button that can't be wired**: the `check for updates` button in
// the top bar has no onClick, and there's no backend to ask — clicking it does nothing, and
// a "visible" style assertion can't tell the difference ([[button-that-cannot-be-wired]]).
// So the criterion here is **what appears on the page after the click**.
//
// The second test guards honesty: dev has no STANDMEET_REDEPLOY_HOOK configured — this
// instance has no host control, so it can't act on an upgrade. In that case the button must
// not be labeled "upgrade". Offering an action the instance can't actually perform is worse
// than offering none, and it lets the whole flow fail silently.
//
// The release registry runs against a mock (STANDMEET_RELEASE_REGISTRY) that claims to have
// shipped v9.9.9 — newer than any real version, so the "a new version exists" state stays
// reliably reachable and doesn't drift with the real release cadence.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'upgrade@example.com', password: 'correct-horse-battery-staple',
  handle: 'upgrader', fullName: 'Upgrade Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('/admin/system · upgrade', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
  });

  test('按下去真的问了镜像库，而不是一个接不上的按钮', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'system');
    const panel = page.getByTestId('system-upgrade');
    await expect(panel).toBeVisible();

    // Before the click: the instance hasn't checked yet. Read the text and then assert on it
    // — `.not.toContainText` passes even before the element appears
    // ([[negated-assertion-passes-while-absent]]).
    const line = page.getByTestId('upgrade-line');
    await expect(line).toBeVisible();
    expect(await line.innerText(), '还没查过的时候不许已经在说版本')
      .not.toContain('9.9.9');

    await page.getByTestId('upgrade-button').click();

    // After the check: the mock claims v9.9.9 shipped, and the page must state that number.
    // This line only appears when both "the button is actually wired" and "the backend
    // really asked the release registry" are true.
    await expect(line, '查完要说出镜像库那边最新是哪一版')
      .toContainText('9.9.9', { timeout: 20_000 });
  });

  test('这台实例按不动的时候，按钮不许写成「升级」', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'system');
    await page.getByTestId('upgrade-button').click();

    const line = page.getByTestId('upgrade-line');
    await expect(line).toContainText('9.9.9', { timeout: 20_000 });

    // dev has no redeploy hook configured — a new version exists, but this instance can't
    // apply it itself.
    const label = await page.getByTestId('upgrade-button').innerText();
    expect(label.toLowerCase(), '按不动就不许把按钮写成升级')
      .not.toContain('upgrade to');
    await expect(line, '要说清为什么按不动，以及该怎么升')
      .toContainText('cannot apply it itself');
  });
});
