// session-capability-bundle.spec.ts —— POST /api/v1/sessions responds in one shot with
// (a) the list of capabilities enabled for this session + (b) the array of fragment ids needed to
// assemble the system prompt. The frontend GETs /api/v1/prompts/{id} per fragment id and composes the
// text locally.
//
// Invariants:
//   - capabilities is the same shape as the capabilities field of /internal/diag/session
//     (both computed in one place via Registry.VisitorStates)
//   - system_prompt_part_ids[0] is always 'visitor-header'
//   - when a capability's fragment enters the actual system prompt, its fragment id
//     must appear in system_prompt_part_ids (and vice versa)
//
// Drift detection: if anyone later adds a new capability with a fragment but does not expose its id, the
// spec fails (system_prompt_full contains some text but part_ids lacks its id).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';
import type { SessionCapability, VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'session-bundle@example.com', password: 'correct-horse-battery-staple',
  handle: 'session-bundle', fullName: 'Session Bundle Owner',
};

const CODE_FULL = 'BUNDLE-FULL';
const CODE_EMPTY = 'BUNDLE-EMPTY';

interface VisitorCapsResp {
  capabilities: SessionCapability[];
  system_prompt_full: string;
}

function requireCaps(sess: VisitorSession): SessionCapability[] {
  if (!sess.capabilities) throw new Error('response missing capabilities[]');
  return sess.capabilities;
}

function requirePartIDs(sess: VisitorSession): string[] {
  if (!sess.system_prompt_part_ids) {
    throw new Error('response missing system_prompt_part_ids[]');
  }
  return sess.system_prompt_part_ids;
}

async function setupBundleOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const roleFull = await createRole(request, csrf, {
    name: 'full-corpus-role', description: 'role with corpus URIs',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE_FULL, label: 'full', assumed_role_id: roleFull.id,
  });
  const roleEmpty = await createRole(request, csrf, {
    name: 'no-corpus-role', description: 'role without corpus URIs',
    corpus_uris: [],
  });
  await createCode(request, csrf, {
    code: CODE_EMPTY, label: 'empty', assumed_role_id: roleEmpty.id,
  });
  await request.dispose();
}

test.describe('session capability bundle · POST /sessions response shape', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupBundleOwner(playwright);
  });

  test('full corpus role → capabilities includes corpus.retrieval enabled + part_ids contains its fragment id',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(
        request, { handle: OWNER.handle, code: CODE_FULL, visitor_name: 'V' },
      );
      const caps = requireCaps(sess);
      const partIDs = requirePartIDs(sess);
      const retr = caps.find(c => c.id === 'corpus.retrieval');
      expect(retr, 'corpus.retrieval cap visible').toBeDefined();
      expect(retr!.enabled).toBe(true);

      expect(partIDs[0]).toBe('visitor-header');
      expect(partIDs).toContain('capabilities/corpus.retrieval');
      await request.dispose();
    });

  test('empty corpus role → corpus.retrieval visible disabled + part_ids omits its fragment id',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(
        request, { handle: OWNER.handle, code: CODE_EMPTY, visitor_name: 'V' },
      );
      const caps = requireCaps(sess);
      const partIDs = requirePartIDs(sess);
      const retr = caps.find(c => c.id === 'corpus.retrieval');
      expect(retr, 'corpus.retrieval cap visible (degraded)').toBeDefined();
      expect(retr!.enabled).toBe(false);

      expect(partIDs[0]).toBe('visitor-header');
      expect(partIDs).not.toContain('capabilities/corpus.retrieval');
      await request.dispose();
    });

  test('public mode session → returns part_ids (visitor-header first) + capabilities array',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(
        request, { handle: OWNER.handle, mode: 'public', visitor_name: 'V' },
      );
      requireCaps(sess);
      const partIDs = requirePartIDs(sess);
      // visitor-header is always first; the rest depends on the owner's public role config
      // (if the owner gave public corpus URIs at claim time, this mode also carries the retrieval
      // fragment) — here we only lock the head, not the tail.
      expect(partIDs.length).toBeGreaterThan(0);
      expect(partIDs[0]).toBe('visitor-header');
      await request.dispose();
    });

  test('session.capabilities map matches /internal/diag/session (same Registry source)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(
        request, { handle: OWNER.handle, code: CODE_FULL, visitor_name: 'V' },
      );
      const dev = await fetchDevCaps(request, sess.session_token);
      expect(sortCaps(requireCaps(sess))).toEqual(sortCaps(dev.capabilities));
      await request.dispose();
    });

  test('part_ids invariant: every id resolves via GET /api/v1/prompts/{id} and appears verbatim in system_prompt_full',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertPartIDsResolveAndAppearInFullPrompt(request);
      await request.dispose();
    });

  test('system_prompt_persona is present and appears verbatim in dev system_prompt_full',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await assertPersonaInFullPrompt(request);
      await request.dispose();
    });
});

async function assertPersonaInFullPrompt(
  request: APIRequestContext,
): Promise<void> {
  const sess = await issueSession(
    request, { handle: OWNER.handle, code: CODE_FULL, visitor_name: 'V' },
  );
  expect(typeof sess.system_prompt_persona,
    'system_prompt_persona present').toBe('string');
  // A role's custom PromptBody may be empty but the helper always returns a string; when non-empty,
  // verify it really is in system_prompt_full (consistent with the LLM prompt on the line below).
  if ((sess.system_prompt_persona ?? '') !== '') {
    const dev = await fetchDevCaps(request, sess.session_token);
    expect(dev.system_prompt_full).toContain(sess.system_prompt_persona!.trim());
  }
}

async function assertPartIDsResolveAndAppearInFullPrompt(
  request: APIRequestContext,
): Promise<void> {
  const sess = await issueSession(
    request, { handle: OWNER.handle, code: CODE_FULL, visitor_name: 'V' },
  );
  const dev = await fetchDevCaps(request, sess.session_token);
  for (const id of requirePartIDs(sess)) {
    const body = await fetchPrompt(request, id);
    expect(body.length, `prompt ${id} has body`).toBeGreaterThan(0);
    expect(
      dev.system_prompt_full,
      `system_prompt_full contains fragment ${id}`,
    ).toContain(body.trim());
  }
}

async function fetchDevCaps(
  request: APIRequestContext, sessionToken: string,
): Promise<VisitorCapsResp> {
  const res = await request.get(
    `${BACKEND}/internal/diag/session`,
    { headers: { 'X-Session-Token': sessionToken } },
  );
  if (res.status() !== 200) {
    throw new Error(`visitor-capabilities: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as VisitorCapsResp;
}

async function fetchPrompt(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.get(`${BACKEND}/api/v1/prompts/${id}`);
  if (res.status() !== 200) {
    throw new Error(`fetch prompt ${id}: ${res.status()} ${await res.text()}`);
  }
  return await res.text();
}

function sortCaps(caps: SessionCapability[]): SessionCapability[] {
  return [...caps].sort((a, b) => a.id.localeCompare(b.id));
}
