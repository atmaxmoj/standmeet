// connector-oauth-pkce.spec.ts — F-C-44: **the dance must carry PKCE.**
//
// `calendar-connect`'s check 2 calls it out by name: *"the exchange carries the secret,
// the PKCE verifier and the real redirect URI"*. Ran the real Google dance four times in
// prod on 2026-08-20, and every single authorize URL only carried
// `access_type / client_id / prompt / redirect_uri / response_type / scope / state` —
// **not a single `code_challenge`**, and zero hits for it in the code either.
//
// What PKCE blocks is **the authorization code being intercepted mid-flight**: state
// covers CSRF (that half already has a spec guarding it), but whoever grabs the code
// can exchange it for a token as soon as they also have the client secret. This
// connector's redirect lands on plaintext-HTTP localhost, and the card's own copy says
// this is a Desktop client — Google already requires PKCE for that class.
//
// Two assertions, pulling in opposite directions, and neither is optional:
//   1. the authorize URL carries `code_challenge` + `code_challenge_method=S256` (was
//      it sent at all);
//   2. the whole dance can actually exchange a token (the verifier sent **matches** the
//      challenge) — the stand-in now verifies S256 and returns invalid_grant on a
//      mismatch. Asserting only #1 would let an implementation pass by sending a random
//      string as the challenge, and that "sent but doesn't match" implementation could
//      never succeed even once.

import { test, expect } from '@/fixtures/test';

import { getGCalStatus, grantedScopes, initGCalOAuth } from '@/fixtures/gcal';
import { seedOwnerGCalConnected, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';

test.describe('F-C-44 · the OAuth dance carries a PKCE challenge', () => {
  let seed: BaseSeed | undefined;
  test.afterAll(async () => { await teardownSeed(seed); });

  test('authorize sends a S256 challenge, and the exchange still gets a token',
    async ({ playwright }) => {
      test.setTimeout(120_000);
      // seedOwnerGCalConnected runs the whole dance: init → follows the 302 to
      // callback → the backend exchanges the token. It **only completes when the
      // verifier matches**, so it is itself assertion #2.
      seed = await seedOwnerGCalConnected(playwright);

      const status = await getGCalStatus(seed.request);
      expect(status.connected,
        'the dance completed, so the verifier the product sent matched the challenge')
        .toBe(true);
      expect(await grantedScopes(seed.request),
        'and it came back with a real grant, not an empty one')
        .not.toHaveLength(0);

      // Assertion #1: what the authorize URL itself says. Firing off another init
      // reads it (no need to complete the dance again).
      const { auth_url: authURL } = await initGCalOAuth(seed.request, seed.csrf);
      const q = new URL(authURL).searchParams;

      expect(q.get('code_challenge_method'),
        'PKCE is S256 — the plain method is no protection at all')
        .toBe('S256');
      expect(q.get('code_challenge') ?? '',
        'and the challenge itself is there')
        .not.toHaveLength(0);
    });
});
