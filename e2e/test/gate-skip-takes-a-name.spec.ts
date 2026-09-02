// gate-skip-takes-a-name.spec.ts —— "skip entering a name" also uses up one of the code's
// member slots, and that fact needs to be stated next to the button.
//
// The behavior itself is correct (owner already confirmed it): clicking skip goes through
// resolveAnonMember → CreateAnonymousMember, and **every click creates a new member row** —
// the anonymous path has no notion of "the same person". So one person clicking skip twice
// uses up two slots, and the second click is not grouped with the first.
//
// But the picker modal only explains the named half — "the same name gets grouped together,
// a different name counts as a new person" — it says nothing about skip, and the skip
// button itself just says "skip". I hit this myself during a real-environment audit: with
// the same code, entering a name showed 1/10, then one click of skip made it 2/10, with no
// visible reason why. If I can hit it, a visitor will too, and the cost lands on the owner's
// quota.
//
// What's asserted is **that the explanation exists**, not the behavior — the behavior is
// already correct.

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'skipnote@example.com', password: 'correct-horse-battery-staple',
  handle: 'skipnote', fullName: 'Skip Note Owner',
};

const CODE = 'SKIP-NOTE1';

test.describe('gate · the identity picker says what skipping costs', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // "Uses up one slot" only makes sense when there's a member cap.
    await createCode(request, csrf, { code: CODE, label: 'skip note', max_members: 10 });
    await request.dispose();
  });

  test('the picker explains that skipping still uses one of the code names', async ({ page }) => {
    await goto(page, `/?code=${CODE}`);
    const skip = page.getByTestId('visitor-name-skip');
    await expect(skip).toBeVisible();

    // This is the block that explains the slot rule; skip's cost belongs alongside the
    // named-entry rule.
    const copy = (await page.getByTestId('visitor-name-capacity').innerText()).toLowerCase();

    expect(copy, 'the picker must explain the named-reuse rule')
      .toContain('same name');
    // The cost of skip: it also consumes a member slot. The owner's quota is spent while
    // the visitor sees nothing about it.
    expect(copy, 'skipping must be described as taking one of the code names')
      .toMatch(/skip[\s\S]{0,160}name/);
  });
});
