// connector-gcal-rotate-creds-reverify.spec.ts —— §三 D-5 行
// 「改身份字段：calendar 换 client_id/secret」(edit-config) → 清 token
// (refresh_token=NULL) → connected=false → booking tool 隐藏 → 重 OAuth 才恢复。
//
// RED / TDD：依赖 connector 依赖解析重构 + 「身份字段变 → 重验」逻辑落地后才转绿。
// 现状 saveGCalCredentials 二次写不清 token，本 spec 期望 connected 翻 false。
//
// Identity-field change re-verify (decision D-5): rotating GCal client_id/secret
// is an identity change → backend MUST clear the refresh token → status flips to
// connected=false → calendar_book is hidden until the owner re-runs OAuth.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import {
  saveGCalCredentials, getGCalStatus, type GCalCredentials,
} from '@/fixtures/gcal';
import {
  seedOwnerGCalConnected, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';
import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import { OWNER } from '@/fixtures/gcal-setup';

// 与默认 MOCK_GCAL_CREDS 不同的一组凭据 —— 模拟 owner 换了 Google project。
const ROTATED_CREDS: GCalCredentials = {
  client_id: 'mock-gcal-client-id-ROTATED',
  client_secret: 'mock-gcal-client-secret-ROTATED',
};

test.describe('connector · GCal rotate credentials → re-verify (§3 D-5)', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('connected → save NEW client_id/secret → connected flips false, booking hidden',
    async () => {
      // precondition: fully connected.
      const before = await getGCalStatus(seed.request);
      expect(before.connected).toBe(true);

      // owner rotates the OAuth client identity → must reset the connection.
      await saveGCalCredentials(seed.request, seed.csrf, ROTATED_CREDS);

      const after = await getGCalStatus(seed.request);
      // identity change cleared the refresh token → no longer connected.
      expect(after.connected).toBe(false);
      // credentials themselves are present (the new ones), it's the token that's gone.
      expect(after.has_credentials).toBe(true);

      // gate side: the booking tool must drop out of the assembled spec for a
      // fresh session (single-point gate recomputes connector state).
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'],
      });
      const sess = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'V',
      });
      await expectCalendarBookExposed(seed.request, sess.session_token, false);
    });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  return seedOwnerGCalConnected(playwright);
}
