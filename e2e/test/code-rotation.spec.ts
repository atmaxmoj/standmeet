// code-rotation.spec.ts —— rotating a code's STRING is the owner's leak-recovery lever (owner:
// "泄漏了我至少有办法，改一下它，app-6fivxx 就行了"). This is a security-critical path, so it is
// tested against the REAL stack end to end:
//   1. the OLD string stops opening sessions the instant it's rotated — the leaked code is dead;
//   2. the NEW string opens sessions;
//   3. the code ID is unchanged, so everything keyed on the id (embeds, application rows) survives;
//   4. rotating onto another code's string is rejected (409) — no silent collision — and both survive.
// (The usecase also purges the code's live visitor sessions on rotation — the leaker's active token
// dies too; that DeleteByCode path is covered by visitor_session_revoke_test.)

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createCode, rotateCode, rotateCodeStatus } from '@/fixtures/codes';
import { issueSession, issueSessionStatus } from '@/fixtures/visitor';

const OWNER = {
  email: 'rotate@example.com', password: 'correct-horse-battery-staple',
  handle: 'rotateowner', fullName: 'Rotate Owner',
};

test.describe('access code rotation (leak recovery)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('rotation kills the old string and activates the new one; the code id is unchanged',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const code = await createCode(request, csrf, { code: 'APP-OLDLEAK', label: 'app' });

      // The old string opens a session (it works before rotation).
      const before = await issueSession(request, { handle: OWNER.handle, mode: 'code', code: 'APP-OLDLEAK' });
      expect(before.conversation_id, 'the old code opens a session before rotation').toBeTruthy();

      // Rotate the string.
      const rotated = await rotateCode(request, csrf, code.id, 'APP-NEWSAFE');
      expect(rotated.code, 'the row now carries the new string').toBe('APP-NEWSAFE');
      expect(rotated.id, 'the code ID is unchanged — code_id-keyed links (embeds, applications) survive').toBe(code.id);

      // 1. The OLD (leaked) string is now DEAD — it no longer opens a session.
      expect(await issueSessionStatus(request, { handle: OWNER.handle, mode: 'code', code: 'APP-OLDLEAK' }),
        'the leaked old string no longer opens a session').not.toBe(200);

      // 2. The NEW string opens a session.
      const after = await issueSession(request, { handle: OWNER.handle, mode: 'code', code: 'APP-NEWSAFE' });
      expect(after.conversation_id, 'the new code opens a session').toBeTruthy();

      await request.dispose();
    });

  test('rotating onto another code’s string is rejected (409); both codes stay usable',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const a = await createCode(request, csrf, { code: 'ROT-AAA', label: 'a' });
      await createCode(request, csrf, { code: 'ROT-BBB', label: 'b' });

      expect(await rotateCodeStatus(request, csrf, a.id, 'ROT-BBB'), 'collision with an existing code is rejected')
        .toBe(409);

      // A is untouched — its original string still opens a session.
      const s = await issueSession(request, { handle: OWNER.handle, mode: 'code', code: 'ROT-AAA' });
      expect(s.conversation_id, 'the rejected rotation left code A on its original string').toBeTruthy();

      await request.dispose();
    });
});
