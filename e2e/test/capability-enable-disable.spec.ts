// capability-enable-disable.spec.ts —— Phase H / P.6+P.7：可用性（availability）
// 是 owner-plane 的门。owner 在「能力」面板关掉一个能力 → 它的 tool 立刻从访客
// session 里消失；**builtin 也能关**（P.7：builtin 可关不可删）。再打开 → 回来。
//
// exposed = exists(origin) ∧ owner_enabled ∧ connector_deps_met ∧ role_acl ∧ quota
// 本 spec 锁的是 owner_enabled 这一门，对 builtin 一视同仁（corpus.retrieval 是
// 内建、且任何带 corpus 授权的访客都看得到 corpus_search）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession } from '@/fixtures/visitor';
import {
  findCapability, setCapabilityEnabled, sessionToolNames,
} from '@/fixtures/capabilities';

const OWNER = {
  email: 'cap-toggle@example.com', password: 'correct-horse-battery-staple',
  handle: 'captoggle', fullName: 'Cap Toggle Owner',
};

const CODE = 'CAP-TOGGLE-1';
// corpus.retrieval 是内建能力，暴露 corpus_search / corpus_read 给任何带 corpus
// 授权的访客。
const RETRIEVAL_ID = 'corpus.retrieval';
const RETRIEVAL_TOOL = 'corpus_search';

let csrf = '';
let admin: APIRequestContext;

test.describe('Phase H · capability enable/disable (owner-plane availability gate)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    admin = await playwright.request.newContext();
    const request = admin;
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    const role = await createRole(request, csrf, {
      name: 'cap-toggle-role', description: 'wiki://**', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, { code: CODE, label: 'cap toggle', assumed_role_id: role.id });
    await createAPIToken(request, csrf, 'cap-toggle-seed');
  });

  test.afterAll(async () => { await admin?.dispose(); });

  test('builtin corpus.retrieval: listed as builtin + enabled + NOT deletable',
    async () => {
      const request = admin;
      const cap = await findCapability(request, csrf, RETRIEVAL_ID);
      expect(cap, 'corpus.retrieval listed').toBeDefined();
      expect(cap?.origin).toBe('builtin');
      expect(cap?.enabled).toBe(true);
      expect(cap?.deletable, 'builtin not deletable').toBe(false);
    });

  test('disable a builtin → its tool disappears from a visitor session; re-enable → back',
    async () => {
      const request = admin;
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });

      // baseline: corpus_search exposed.
      expect(await sessionToolNames(request, sess.session_token))
        .toContain(RETRIEVAL_TOOL);

      // owner disables the builtin → availability gate closes (assemble-time).
      expect(await setCapabilityEnabled(request, csrf, RETRIEVAL_ID, false)).toBe(200);
      expect(await sessionToolNames(request, sess.session_token), 'disabled → gone')
        .not.toContain(RETRIEVAL_TOOL);

      // re-enable → comes back.
      expect(await setCapabilityEnabled(request, csrf, RETRIEVAL_ID, true)).toBe(200);
      expect(await sessionToolNames(request, sess.session_token), 're-enabled → back')
        .toContain(RETRIEVAL_TOOL);

    });
});
