// sync-large-vault.spec.ts —— a vault of realistic size must import successfully.
//
// The real vault (574 wiki + 435 raw) is 1033 files after client-side filtering, and the
// import fails with a flat 400 at **1001 parts**. The measured boundary: 999 parts succeed
// and do real work, 1001 parts report `parse multipart: multipart: message too large`.
//
// What's actually blocking this is not the limit the product declares —
// `maxObsidianImportSize` is **200MB**, and the payload is only 6.2MB. What's blocking it is
// Go's `mime/multipart.ReadForm` default cap of **1000 parts** while buffering the whole
// form — a number nobody ever stated out loud. One file over that, and the whole import is voided.

// Every existing sync-* case feeds in a few dozen synthetic files; the scale dimension has
// never been asserted — this is exactly the mock gap item vault-sync check 1 names: "Hundreds
// of notes … nothing dropped" has never been asserted at scale.
//
// This case asserts exactly one thing: **the part count must not be the import's ceiling.**

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'bigvault@example.com', password: 'correct-horse-battery-staple',
  handle: 'bigvault', fullName: 'Big Vault Owner',
};

// 1200 —— comfortably clears the 1000-part wall without turning this case into a load test.
// The real vault is 1033.
const NOTES = 1200;

test.describe('vault-sync · a real-sized vault imports', () => {
  test.beforeAll(async ({ request }) => {
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
  });

  test('a vault of more than a thousand notes imports without a part-count wall',
    async ({ request }) => {
      const files = Array.from({ length: NOTES }, (_, i) => ({
        rel: `wiki/scale/note-${String(i).padStart(4, '0')}.md`,
        body: makeVaultMD({ publish: false }, `# Note ${i}\n\nbody ${i}`),
      }));

      const res = await uploadVault(request, OWNER, files, { authoritative: true });

      // At minimum every note must land — "no error" doesn't count, one missing note is
      // still dropped. `>=` is used because an intermediate folder adds one extra placeholder
      // node (`wiki/scale/` itself), which is check 3's intended behavior and shouldn't be
      // overridden by a hardcoded equality.
      expect(
        res.created + res.updated,
        `all ${NOTES} notes must land; a part count must not be the ceiling`,
      ).toBeGreaterThanOrEqual(NOTES);
      expect(res.errors, 'no note may fail to sync').toHaveLength(0);
    });
});
