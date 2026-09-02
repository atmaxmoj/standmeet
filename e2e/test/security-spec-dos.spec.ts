// security-spec-dos.spec.ts — pentest. Connector spec ingestion
// (POST /connectors/validate-spec) parses arbitrary OpenAPI text pasted by the
// owner. A malicious spec must not be able to bring down parsing: an oversize body
// (>4MiB) gets cut off by a LimitReader, deep nesting doesn't overflow the stack,
// a YAML alias bomb (billion-laughs) doesn't expand exponentially and OOM. Contract:
// every case returns **promptly** with either 400 or 200{ok:false}, never hangs,
// never returns ok:true. Green = parsing is bounded; red = one malicious spec can DoS
// the instance.

import { test, expect } from '@/fixtures/test';

import { seedOwnerLoggedIn, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// billion-laughs: YAML aliases expand exponentially. A safe parser either doesn't
// expand them or bounds the expansion → rejects.
const BILLION_LAUGHS = [
  'a: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]',
  'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
  'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
  'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
  'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
  'openapi: "3.0.0"',
  'info: {title: boom, version: "1", x: *e}',
].join('\n');

const DEEP_NEST = '{"openapi":"3.0.0","x":' + '['.repeat(100000) + ']'.repeat(100000) + '}';
const OVERSIZE = '{"openapi":"3.0.0","pad":"' + 'A'.repeat(5 << 20) + '"}'; // >4 MiB body cap

test.describe('pentest · connector spec-ingest DoS resistance', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerLoggedIn(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  for (const [name, spec] of [
    ['billion-laughs YAML aliases', BILLION_LAUGHS],
    ['100k-deep nesting', DEEP_NEST],
    ['oversize body (>4MiB)', OVERSIZE],
  ] as const) {
    test(`malicious spec is bounded, not a hang: ${name}`, async () => {
      // 15s hard cap: bounded parsing finishes far faster than this; if it hangs
      // (a real DoS) it times out → red.
      // This security probe deliberately bypasses the UI to hit the raw API
      // directly — that's exactly the attacker's perspective (a DoS boundary), so
      // the UI-write rule is disabled here.
      /* eslint-disable no-restricted-syntax */
      const res = await seed.request.post(`${BACKEND}/api/admin/connectors/validate-spec`, {
        headers: { 'X-Csrftoken': seed.csrf },
        data: { spec, url: '' },
        timeout: 15_000,
      });
      /* eslint-enable no-restricted-syntax */
      // A malformed body → 400; parseable but invalid → 200{ok:false}. Either is
      // acceptable; never a 5xx crash, never ok:true.
      expect(res.status(), `${name}: no 5xx crash`).toBeLessThan(500);
      if (res.status() === 200) {
        const body = await res.json() as { ok?: boolean };
        expect(body.ok, `${name}: malicious spec never validates OK`).not.toBe(true);
      }
    });
  }
});
