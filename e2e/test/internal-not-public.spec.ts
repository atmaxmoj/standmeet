// internal-not-public.spec.ts —— /internal/* is for the services on the instance's own network
// (builder, im-bridge, the app's server side), never for the public origin.
//
// Found 2026-10-07 (refactor ledger R20): the app rewrote /internal/:path* to the backend, and
// every reverse proxy (Caddy, Coolify's Traefik) sends the whole origin to the app — so the
// public internet reached /internal on every self-hosted instance. On sijie.xyz an anonymous
// GET of /internal/diag/registry answered 200. Behind the same door: /internal/im/config (the
// owner's IM bot tokens), /internal/diag/supplier/{id}/invoke (a supplier action, e.g. mail),
// and the builder's claim / report endpoints. Every legitimate caller dials the backend directly.

import { test, expect } from '@/fixtures/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.describe('the public origin does not reach /internal', () => {
  test('internal endpoints through the public origin are not found', async ({ request }) => {
    for (const path of ['/internal/diag/registry', '/internal/im/config', '/internal/healthz']) {
      expect((await request.get(path)).status(), `GET ${path} via the public origin`).toBe(404);
    }
    expect((await request.post('/internal/builds/claim')).status(),
      'the builder claim via the public origin').toBe(404);
  });

  test('the services on the instance network still reach them', async ({ request }) => {
    expect((await request.get(`${BACKEND}/internal/healthz`)).status()).toBe(200);
  });
});
