// security-inference-models-ssrf.spec.ts —— RED repro (bug hunt #1, HIGH). The UNAUTHENTICATED
// endpoint POST /api/v1/inference/models proxies GET {endpoint}/v1/models with the caller-supplied
// `endpoint`, and builds its httpx client with NO egress guard (inference_models.go
// callUpstreamModelsAPI → httpx.NewClient{Timeout} only). So any anonymous caller can make the
// server dial an internal/link-local address — read cloud metadata (169.254.169.254), hit
// loopback-only admin services, port-scan the private net. Boundary: the server must refuse to
// dial an internal address and say so (like the connector egress guard already does).
//
// Mirrors connector-security.spec.ts's SSRF assertion exactly. GREEN = boundary holds; currently
// RED — the server dials the internal target and returns a generic "provider unreachable" whose
// message does not name the address policy (and, worse, actually reached loopback/metadata).

import { test, expect } from '@/fixtures/test';

import { INTERNAL_SERVER_URLS } from '@/fixtures/connector-security-specs';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// same policy-naming regex the connector SSRF contract asserts on.
const SSRF_REJECT_RE = /internal|loopback|private|not allowed|disallow|blocked/i;

test.describe('security · inference model discovery must not SSRF internal addresses', () => {
  for (const url of INTERNAL_SERVER_URLS) {
    test(`POST /inference/models endpoint=${url} → refused, no internal dial`, async ({
      playwright,
    }) => {
      const request = await playwright.request.newContext();
      const res = await request.post(`${BACKEND}/api/v1/inference/models`, {
        data: { provider: 'openai', endpoint: url, key: 'sk-probe' },
      });
      const text = await res.text();
      expect(res.status(), `internal endpoint must be refused: ${url}`).toBeGreaterThanOrEqual(400);
      expect(res.status(), `refusal is not a crash: ${url}`).toBeLessThan(500);
      expect(text, `refusal names the address policy: ${url}`).toMatch(SSRF_REJECT_RE);
      expect(text, 'no cloud metadata exfiltrated').not.toContain('meta-data');
      expect(text, 'no raw go panic / stack trace leaked').not.toContain('goroutine');
      await request.dispose();
    });
  }
});
