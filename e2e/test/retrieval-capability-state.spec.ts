// retrieval-capability-state.spec.ts -- Phase B-2 contract: the
// corpus.retrieval capability appears on the visitor-capabilities endpoint,
// and its enabled gating goes through RoleSnapshot.CorpusURIs (non-empty =
// enabled=true; empty = enabled=false but still present so the frontend can
// render a degraded-state hint).
//
// Business story:
//   alice creates role R1 with corpus_uris=['wiki://**', 'output://**', 'writing://**'],
//   issues code CORPUS-001 -> a visitor gets session V1, and
//   /visitor-capabilities must return:
//     - capabilities[?].id=='corpus.retrieval' enabled=true
//     - tool_specs contains all three of corpus_search / corpus_read / corpus_list
//   alice creates role R0 with corpus_uris=[] (an empty list), issues code
//   EMPTY-001 -> visitor V2:
//     - capabilities[?].id=='corpus.retrieval' enabled=false
//     - tool_specs still contains all three (the spec is always exposed; the
//       ACL blocks internally)
//
// Regression coverage for existing retrieval behavior is backstopped by
// specs like visitor-chat-cites-output / hidden-source / raw-deny / freeze;
// this spec only verifies the capability-map contract introduced by B-2.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'retrieval@example.com', password: 'correct-horse-battery-staple',
  handle: 'retrieval', fullName: 'Retrieval Owner',
};

const FULL_CODE = 'CORPUS-001';
const EMPTY_CODE = 'EMPTY-001';

interface VisitorCap { id: string; enabled: boolean }
interface VisitorCapabilitiesResp {
  capabilities: VisitorCap[];
  tool_specs: Array<{ name: string }>;
  system_prompt_hash: string;
}

test.describe('Phase B-2 RetrievalCapability state contract', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await seedRolesAndCodes(request);
    await request.dispose();
  });

  test('role with corpus URIs → corpus.retrieval enabled + 3 tool specs',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: FULL_CODE, visitor_name: 'Inspector',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      const corpusCap = body.capabilities.find((c) => c.id === 'corpus.retrieval');
      expect(corpusCap, 'corpus.retrieval must appear').toBeDefined();
      expect(corpusCap?.enabled).toBe(true);
      const toolNames = body.tool_specs.map((t) => t.name);
      expect(toolNames).toContain('corpus_search');
      expect(toolNames).toContain('corpus_read');
      expect(toolNames).toContain('corpus_list');
      await request.dispose();
    });

  test('role with empty corpus_uris → corpus.retrieval enabled=false but visible',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: EMPTY_CODE, visitor_name: 'Inspector',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      const corpusCap = body.capabilities.find((c) => c.id === 'corpus.retrieval');
      expect(corpusCap, 'corpus.retrieval must still appear').toBeDefined();
      expect(corpusCap?.enabled).toBe(false);
      // tool_specs is still exposed -- the LLM can still call it, and gets
      // denied by the internal ACL (snapshot.AllowsCorpus always returns
      // false for empty uris); the frontend renders a "no corpus access"
      // hint from enabled=false.
      const toolNames = body.tool_specs.map((t) => t.name);
      expect(toolNames).toContain('corpus_search');
      expect(toolNames).toContain('corpus_read');
      expect(toolNames).toContain('corpus_list');
      await request.dispose();
    });

  test('system_prompt_hash differs between full vs empty corpus roles',
    async ({ playwright }) => {
      // The two roles' RoleSnapshots differ (PromptBody is identical -- both
      // empty -- but different corpus_uris should affect the retrieval
      // fragment -> affect the hash). Even with both PromptBody empty,
      // differing capability state should still make the hashes diverge.
      const request = await playwright.request.newContext();
      const sessFull = await issueSession(request, {
        handle: OWNER.handle, code: FULL_CODE, visitor_name: 'A',
      });
      const sessEmpty = await issueSession(request, {
        handle: OWNER.handle, code: EMPTY_CODE, visitor_name: 'B',
      });
      const full = await fetchVisitorCapabilities(request, sessFull.session_token);
      const empty = await fetchVisitorCapabilities(request, sessEmpty.session_token);
      expect(full.system_prompt_hash).not.toBe(empty.system_prompt_hash);
      await request.dispose();
    });
});

async function seedRolesAndCodes(request: APIRequestContext): Promise<void> {
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const full = await createRole(request, csrf, {
    name: 'full-corpus',
    description: 'all genres',
    corpus_uris: ['wiki://**', 'output://**', 'writing://**'],
  });
  const empty = await createRole(request, csrf, {
    name: 'no-corpus',
    description: 'no genres',
    corpus_uris: [],
  });
  await createCode(request, csrf, {
    code: FULL_CODE, label: 'full corpus', assumed_role_id: full.id,
  });
  await createCode(request, csrf, {
    code: EMPTY_CODE, label: 'empty corpus', assumed_role_id: empty.id,
  });
}

async function fetchVisitorCapabilities(
  request: APIRequestContext, sessionToken: string,
): Promise<VisitorCapabilitiesResp> {
  const res = await request.get(
    `${BACKEND}/internal/diag/session`,
    { headers: { 'X-Session-Token': sessionToken } },
  );
  if (res.status() !== 200) {
    throw new Error(`visitor-capabilities: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as VisitorCapabilitiesResp;
}
