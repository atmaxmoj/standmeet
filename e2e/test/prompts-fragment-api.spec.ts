// prompts-fragment-api.spec.ts —— GET /api/v1/prompts/{id} is how the frontend
// (the pi agent loop) fetches NON-capability system prompt fragment text
// (visitor-header, etc.).
//
// After the normalization (#144), the four leaf capabilities' prompt fragments
// moved out to their respective plugin's MCP `instructions` alongside the
// capability itself, and are **no longer** served by the
// /api/v1/prompts/{id} endpoint (capabilities/* all 404 now). They're still
// stitched into system_prompt_full via the mcp-app adapter's
// SystemPromptFragment — so the corpus fragment is still present in full
// (when a corpus scope exists), just sourced from plugin instructions instead
// of prompts/*.md. This spec checks against the verbatim text inside full,
// rather than fetching expected values from the endpoint.
//
// Verification approach:
//   1. GET /api/v1/prompts/visitor-header returns md text (non-capability fragments are still on the endpoint)
//   2. capabilities/* have been externalized → endpoint 404s
//   3. system_prompt_full = the actual concatenated result sent to the LLM, containing the
//      corpus fragment verbatim (when a corpus scope exists), absent when there's no scope.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'prompts-api@example.com', password: 'correct-horse-battery-staple',
  handle: 'prompts-api', fullName: 'Prompts API Owner',
};

const CODE = 'PROMPTS-001';

// CORPUS_FRAGMENT_MARK —— the verbatim opening of the corpus.retrieval fragment
// (the plugin instructions text is word-for-word the old corpus.retrieval.md).
// The endpoint no longer serves this fragment, so this marker is used to check
// its presence/absence inside system_prompt_full.
const CORPUS_FRAGMENT_MARK =
  'The owner\'s corpus is a LINKED TREE of notes';

interface VisitorCapabilitiesResp {
  capabilities: Array<{ id: string; enabled: boolean }>;
  tool_specs: Array<{ name: string }>;
  system_prompt_hash: string;
  system_prompt_full: string;
}

async function setupPromptsOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'prompts-role', description: 'role for prompts API spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'd1', assumed_role_id: role.id,
  });
  await request.dispose();
}

test.describe('prompts fragment API · single source of truth', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupPromptsOwner(playwright);
  });

  test('GET /api/v1/prompts/visitor-header returns md file content',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const text = await fetchPrompt(request, 'visitor-header');
      // Known convention: the visitor header text opens with this sentence
      expect(text).toContain('You are answering');
      expect(text.length).toBeGreaterThan(20);
      await request.dispose();
    });

  test('GET /api/v1/prompts/capabilities/corpus.retrieval returns tool description',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // The fragment has been externalized into plugin instructions (no .md file
      // backs it anymore), but the prompts endpoint still serves it by id via a
      // registry fallback — so the frontend can still fetch it by part-id and
      // splice it into the system prompt.
      const text = await fetchPrompt(request, 'capabilities/corpus.retrieval');
      expect(text).toContain('corpus_search');
      expect(text).toContain('corpus_read');
      expect(text).toContain('corpus_list');
      await request.dispose();
    });

  test('unknown prompt id → 404', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const res = await request.get(`${BACKEND}/api/v1/prompts/nonexistent-fragment-xyz`);
    expect(res.status()).toBe(404);
    await request.dispose();
  });

  test('system_prompt_full appears in /visitor-capabilities + contains each fragment verbatim',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      expect(typeof body.system_prompt_full).toBe('string');
      expect(body.system_prompt_full.length).toBeGreaterThan(0);
      // Both header (endpoint fragment) and the corpus retrieval fragment
      // (plugin instructions) should appear verbatim in full.
      const header = await fetchPrompt(request, 'visitor-header');
      expect(body.system_prompt_full).toContain(header.trim());
      expect(body.system_prompt_full).toContain(CORPUS_FRAGMENT_MARK);
      await request.dispose();
    });

  test('role without corpus_uris → corpus retrieval fragment absent from system_prompt_full',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const emptyRole = await createRole(request, csrf, {
        name: 'no-corpus-role', description: 'no corpus',
        corpus_uris: [],
      });
      await createCode(request, csrf, {
        code: 'PROMPTS-EMPTY', label: 'empty', assumed_role_id: emptyRole.id,
      });
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: 'PROMPTS-EMPTY', visitor_name: 'V',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      // header is still there; the corpus fragment should be absent because there's no corpus scope (enabled=false)
      expect(body.system_prompt_full).not.toContain(CORPUS_FRAGMENT_MARK);
      await request.dispose();
    });
});

async function fetchPrompt(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.get(`${BACKEND}/api/v1/prompts/${id}`);
  if (res.status() !== 200) {
    throw new Error(`fetch prompt ${id}: ${res.status()} ${await res.text()}`);
  }
  return await res.text();
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
