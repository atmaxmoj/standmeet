// security-byoai-endpoint-ssrf.spec.ts —— RED repro (bug hunt #4, MED-HIGH). A BYOAI visitor
// supplies X-Byoai-Endpoint; byoai_envelope.go → inference/eino_model.go sets cfg.BaseURL = that
// endpoint on a client from inference/http_retry.go retryHTTPClient(), which has NO egress guard.
// So a BYOAI visitor (no invite code needed) can point the endpoint at an internal/link-local
// address and make the server dial it — SSRF to cloud metadata / loopback-only services. Bringing
// your own PUBLIC endpoint is the feature; an internal address must still be refused.
//
// Same class + same fix as the unauthenticated /inference/models SSRF (#1): install the httpx
// BlockInternalEgress guard and surface a policy-named refusal. GREEN = boundary holds; currently
// RED — the server dials the internal target and the turn fails with a generic dial error (or, for
// a reachable loopback service, succeeds), never naming the address policy.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { issueByoaiSession } from '@/fixtures/visitor';
import { runVisitorChatTurn } from '@/fixtures/visitor-chat-loop';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const SSRF_REJECT_RE = /internal|loopback|private|not allowed|disallow|blocked/i;

// fast-failing internal targets (loopback refuses/answers immediately, no 15s dial hang). The
// unauthenticated-endpoint spec covers the link-local/metadata set; the guard blocks the whole
// class, so loopback here is a sufficient boundary probe.
const INTERNAL_ENDPOINTS = [
  'http://localhost:8000',
  'http://127.0.0.1',
  'http://[::1]:8000',
];

test.describe('security · BYOAI endpoint must not SSRF internal addresses', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'byoai-ssrf-seed');
    const sid = await initMCP(request, token);
    await seedPublicWiki(request, token, sid, {
      body: 'alice loves ASCII sparklines.', title: 'Alice intro', tags: ['intro'],
    });
    await request.dispose();
  });

  for (const url of INTERNAL_ENDPOINTS) {
    test(`byoai endpoint=${url} → refused, no internal dial`, async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueByoaiSession(request, {
        handle: OWNER.handle, byoai_provider: 'openai',
        byoai_key: 'sk-probe', byoai_endpoint: url, byoai_model: 'gpt-4o-mini',
      });
      // a refused turn surfaces as an SSE error frame → runVisitorChatTurn throws its message; a
      // completed turn returns text. Either way capture what the visitor would see.
      let outcome = '';
      try {
        outcome = await (await runVisitorChatTurn(request, sess, 'hello')).text();
      } catch (e) {
        outcome = (e as Error).message;
      }
      expect(outcome, `internal byoai endpoint must be refused by policy: ${url}`)
        .toMatch(SSRF_REJECT_RE);
      expect(outcome, 'no cloud metadata exfiltrated').not.toContain('meta-data');
      await request.dispose();
    });
  }
});
