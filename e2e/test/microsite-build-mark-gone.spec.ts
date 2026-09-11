// microsite-build-mark-gone.spec.ts — the builder reports a build whose row is gone.
//
// This is the DETERMINISTIC reproduction of the race behind flake #972
// (microsite-editor-live-follow): a build is in flight when a concurrent `resetInstance` truncates
// `microsite_builds`; the builder finishes, PATCHes `/internal/builds/{id}` to mark it built/failed,
// and the row is no longer there. "Row gone" and "id never existed" are the SAME code path —
// `MarkBuilt`/`MarkFailed`'s UPDATE … RETURNING hits 0 rows — so a nonexistent id reproduces it
// with no timing window at all.
//
// The bug: `patchBuild` blanket-500s that `pgx.ErrNoRows`, indistinguishable from a real DB fault.
// A build whose row was deleted mid-build is NOT a server fault — it's "superseded / gone", and the
// builder must be told so (404) so it logs and moves on, not throw `mark built: 500`.
//
// No auth: /internal/builds/* is internal-network trust (Caddy blocks it from the public internet),
// reachable from the test the same way the builder reaches it.

import { test, expect } from '@/fixtures/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// A valid-format UUID that is not a real build (the nil UUID). Valid format so it passes the id
// parse and reaches the UPDATE — which then matches 0 rows, exactly as a truncated row would.
const GONE = '00000000-0000-0000-0000-000000000000';

test.describe('microsite build · marking a build whose row is gone', () => {
  test('mark-built on a nonexistent build → 404, not 500 (the #972 race outcome)', async (
    { request },
  ) => {
    const res = await request.patch(`${BACKEND}/internal/builds/${GONE}`, {
      data: { status: 'built', output_path: 'page/build/dist' },
    });
    // The specific failure this guards: a gone build must not read as a server fault. 500 is the
    // bug (the builder then throws `mark built: 500`); 404 is "no such build — superseded / gone".
    expect(res.status(), 'a gone build is not a 500 server fault').not.toBe(500);
    expect(res.status()).toBe(404);
  });

  test('mark-failed on a nonexistent build → 404, not 500', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/internal/builds/${GONE}`, {
      data: { status: 'failed', error_message: 'vite blew up' },
    });
    expect(res.status(), 'a gone build is not a 500 server fault').not.toBe(500);
    expect(res.status()).toBe(404);
  });
});
