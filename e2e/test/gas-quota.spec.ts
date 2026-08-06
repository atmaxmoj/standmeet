// gas-quota.spec.ts —— the paddle on a provider's tank.
//
// Turn quota counts turns; this counts tokens. Same mechanism, different dimension: no counter
// column (remaining is derived from the usage rows since the tank was filled), one preflight before
// the write, one sentinel, and "not configured" returns before any query is issued.
//
// Two switches, and BOTH have to be on for anything to happen:
//   · the provider carries the fuel  (`owner_providers.gas_tokens`, null = unmetered)
//   · the role carries the gauge     (`roles.gas_metered`, false = today's path)
//
// The first test is the one that matters most: an empty tank under an UNMETERED role must behave
// exactly like today. If that ever goes red, every owner who never asked for metering has been
// silently put behind a paddle.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  createProvider, providerByID, setProviderGas, type ProviderView,
} from '@/fixtures/providers';
import { createRole } from '@/fixtures/roles';
import { issueByoaiSession, issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'gas@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'gasowner',
  fullName: 'Gas Owner',
};

const GATEWAY = 'http://llm-gateway:9300';

let csrf = '';
let api: APIRequestContext;
let tank: ProviderView;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  api = await playwright.request.newContext();
  await claim(api, findSetupToken(), OWNER);
  ({ csrf } = await loginAPI(api, OWNER.email, OWNER.password));
  // One tank, pointed at the mock gateway, and every role below points at it.
  tank = await createProvider(api, csrf, {
    label: 'metered-tank', provider: 'anthropic', endpoint: GATEWAY,
    model: 'mock-model-gas', key: 'sk-gas-00000000000',
  });
});

test.describe('gas · the gauge is off unless the role asks for it', () => {
  test('an empty tank on an unmetered role changes nothing', async ({ request }) => {
    await setProviderGas(api, csrf, tank.id, 0);
    const role = await createRole(api, csrf, {
      name: 'unmetered', description: 'no gauge', corpus_uris: ['wiki://**'],
      provider_id: tank.id, // gas_metered defaults to false
    });
    await createCode(api, csrf, {
      code: 'GAS-UNMETERED', label: 'no gauge', assumed_role_id: role.id,
    });

    const sess = await issueSession(request, {
      handle: OWNER.handle, code: 'GAS-UNMETERED', visitor_name: 'V',
    });
    const res = await sendMessage(request, sess, 'hello from an unmetered role');
    expect(res.status(), 'an empty tank must not stop a role with no gauge').toBe(200);
    await res.body();
  });
});

test.describe('gas · a metered role runs out and comes back', () => {
  test('an empty tank refuses the send with a sentence, before anything is written',
    async ({ request }) => {
      await setProviderGas(api, csrf, tank.id, 0);
      const sess = await meteredSession(request, 'GAS-EMPTY', 'ran-dry');

      const blocked = await sendMessage(request, sess, 'anything at all');
      expect(blocked.status()).toBe(403);
      const body = await blocked.json() as { error?: { code?: string; message?: string } };
      expect(body.error?.code).toBe('gas_exhausted');
      // What the visitor reads. Not a status code, not a column name.
      expect(body.error?.message ?? '', 'a human sentence').toMatch(/[a-z]{4,}\s+[a-z]{2,}/i);
      expect(body.error?.message ?? '').not.toMatch(/gas_tokens|inference_usage|40[0-9]/);
    });

  test('filling the tank lets the same visitor through, and spending shows on the gauge',
    async ({ request }) => {
      await setProviderGas(api, csrf, tank.id, 100_000);
      const before = await providerByID(api, tank.id);
      expect(before.gas_remaining, 'a fresh fill reads as full').toBe(100_000);

      const sess = await meteredSession(request, 'GAS-FILLED', 'has-fuel');
      const res = await sendMessage(request, sess, 'hello on a full tank');
      expect(res.status()).toBe(200);
      await res.body();

      const after = await providerByID(api, tank.id);
      expect(after.gas_remaining ?? 0, 'the turn came out of the tank')
        .toBeLessThan(before.gas_remaining ?? 0);
    });

  test('two roles share one tank — spending through one is visible to the other',
    async ({ request }) => {
      // "I put 100k into this provider" means one tank, not one per role. A per-role tank would
      // leave this reading unchanged.
      const start = (await providerByID(api, tank.id)).gas_remaining ?? 0;
      const sess = await meteredSession(request, 'GAS-SECOND-ROLE', 'other-metered-role');
      const res = await sendMessage(request, sess, 'hello from the second role');
      expect(res.status()).toBe(200);
      await res.body();

      const after = (await providerByID(api, tank.id)).gas_remaining ?? 0;
      expect(after, 'the second role drew from the same tank').toBeLessThan(start);
    });

  test('a byoai visitor never touches the tank', async ({ request }) => {
    const before = (await providerByID(api, tank.id)).gas_remaining ?? 0;
    const sess = await issueByoaiSession(request, {
      handle: OWNER.handle, byoai_provider: 'anthropic', byoai_key: 'sk-visitor-own-key',
      byoai_endpoint: GATEWAY, byoai_model: 'mock-model-byoai', visitor_name: 'BYO',
    });
    const res = await sendMessage(request, sess, 'hello on my own key');
    expect(res.status()).toBe(200);
    await res.body();

    const after = (await providerByID(api, tank.id)).gas_remaining ?? 0;
    expect(after, 'the visitor paid for that turn, not the owner').toBe(before);
  });

  test('unmetering the tank clears the gauge for everyone on it', async ({ request }) => {
    await setProviderGas(api, csrf, tank.id, null);
    const cleared = await providerByID(api, tank.id);
    expect(cleared.gas_tokens ?? null, 'null = no paddle on this tank').toBeNull();
    expect(cleared.gas_remaining ?? null).toBeNull();

    const sess = await meteredSession(request, 'GAS-UNMETERED-TANK', 'still-metered-role');
    const res = await sendMessage(request, sess, 'hello with the gauge removed');
    expect(res.status(), 'a metered role over an unmetered tank is unmetered').toBe(200);
    await res.body();
  });
});

// meteredSession —— a role with the gauge ON, pointed at the tank, plus a code and a session.
async function meteredSession(
  request: APIRequestContext, code: string, roleName: string,
) {
  const role = await createRole(api, csrf, {
    name: roleName, description: 'gauge on', corpus_uris: ['wiki://**'],
    provider_id: tank.id, gas_metered: true,
  });
  await createCode(api, csrf, { code, label: roleName, assumed_role_id: role.id });
  return await issueSession(request, {
    handle: OWNER.handle, code, visitor_name: 'V',
  });
}
