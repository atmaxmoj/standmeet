// multi-provider-resolution.spec.ts —— which provider served this turn.
//
// An owner used to hold one provider (four columns on `owners`). It is now a book of entries with
// one default, and a code or a role may point at another one:
//
//     byoai (the visitor's own key)  >  code  >  role  >  default
//
// **Code beats role** (owner, 2026-08-06): the code is the ticket that was handed out, it is the
// more specific statement.
//
// The assertion is on what the gateway actually RECEIVED — model + credential prefix, read back by
// the turn's own script tag (`lastGatewayRequest`). Asserting on an admin getter instead would pass
// while the request still went to the old provider: the getter reports intent, the recorded request
// reports what happened. Each provider row therefore carries a distinct model string; they all point
// at the same mock gateway, because "which upstream" is what is under test, not networking.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { lastGatewayRequest, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import {
  createProvider, deleteProviderStatus, listProviders, setDefaultProvider,
  type ProviderView,
} from '@/fixtures/providers';
import { createRole } from '@/fixtures/roles';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'multiprovider@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'multiprovider',
  fullName: 'Multi Provider Owner',
};

// One gateway, three identities. The model string is the observable.
const GATEWAY = 'http://llm-gateway:9300';
const MODEL_DEFAULT = 'mock-model-default';
const MODEL_CODE = 'mock-model-code';
const MODEL_ROLE = 'mock-model-role';
const KEY_CODE = 'sk-code-0000000000';

interface Book { def: ProviderView; code: ProviderView; role: ProviderView }

let book: Book;
let csrf = '';
// api -- a **logged-in** request context, shared across the whole describe block. The
// spec-level `request` fixture has no owner session, so hitting /api/admin/* always 401s;
// the visitor-facing endpoints are public, so either context works for those.
let api: APIRequestContext;

test.describe.configure({ mode: 'serial' });
test.describe('multi-provider · which provider served this turn', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    api = await playwright.request.newContext();
    await claim(api, findSetupToken(), OWNER);
    ({ csrf } = await loginAPI(api, OWNER.email, OWNER.password));
    book = await seedProviders(api);
  });

  test('claim leaves exactly one provider, and it is the default', async () => {
    // Not a formality: first-run claim is the path nobody re-runs after day one, and it is one of
    // the 18 places that used to write the owner's provider columns directly.
    const all = await listProviders(api);
    expect(all.filter((p) => p.is_default), 'exactly one default').toHaveLength(1);
  });

  test('code override beats the role override', async ({ request }) => {
    const role = await createRole(api, csrf, {
      name: 'both-overridden', description: 'role points at ROLE provider',
      corpus_uris: ['wiki://**'], provider_id: book.role.id,
    });
    await createCode(api, csrf, {
      code: 'PROV-CODE-WINS', label: 'code points at CODE provider',
      assumed_role_id: role.id, provider_id: book.code.id,
    });

    const seen = await turnAndRead(request, 'PROV-CODE-WINS');
    expect(seen.found, 'the gateway recorded this turn').toBe(true);
    expect(seen.model, 'the code is the more specific statement').toBe(MODEL_CODE);
    // The key travels with it — not just the model string. A resolver that picked the row for its
    // model but kept the default's credential would pass a model-only assertion.
    expect(seen.auth_prefix).toBe(KEY_CODE.slice(0, 8));
  });

  test('role override applies when the code carries none', async ({ request }) => {
    const role = await createRole(api, csrf, {
      name: 'role-only', description: 'role points at ROLE provider',
      corpus_uris: ['wiki://**'], provider_id: book.role.id,
    });
    await createCode(api, csrf, {
      code: 'PROV-ROLE-ONLY', label: 'no code override', assumed_role_id: role.id,
    });

    expect((await turnAndRead(request, 'PROV-ROLE-ONLY')).model).toBe(MODEL_ROLE);
  });

  test('neither overrides → the default entry', async ({ request }) => {
    const role = await createRole(api, csrf, {
      name: 'no-override', description: 'plain role', corpus_uris: ['wiki://**'],
    });
    await createCode(api, csrf, {
      code: 'PROV-DEFAULT', label: 'plain code', assumed_role_id: role.id,
    });

    expect((await turnAndRead(request, 'PROV-DEFAULT')).model).toBe(MODEL_DEFAULT);
  });

});

// ════════ the address-book rules: delete, fall back, move the default ════════
test.describe('multi-provider · the book behaves like an address book', () => {
  test('deleting a provider a code points at silently falls back to the default',
    async ({ request }) => {
      // The owner deleted an address from the address book; the order still ships, to the default
      // address. The visitor must see nothing at all — no error, no missing answer.
      const doomed = await createProvider(api, csrf, {
        label: 'doomed', provider: 'anthropic', endpoint: GATEWAY,
        model: 'mock-model-doomed', key: 'sk-doomed-000000000',
      });
      const role = await createRole(api, csrf, {
        name: 'points-at-doomed', description: '', corpus_uris: ['wiki://**'],
      });
      await createCode(api, csrf, {
        code: 'PROV-DOOMED', label: 'points at the doomed provider',
        assumed_role_id: role.id, provider_id: doomed.id,
      });
      expect((await turnAndRead(request, 'PROV-DOOMED')).model).toBe('mock-model-doomed');

      expect(await deleteProviderStatus(api, csrf, doomed.id)).toBe(204);

      const after = await turnAndRead(request, 'PROV-DOOMED');
      expect(after.model, 'a dangling reference resolves to the default').toBe(MODEL_DEFAULT);
    });

  test('deleting the default is refused — there is nothing to fall back to',
    async () => {
      const status = await deleteProviderStatus(api, csrf, book.def.id);
      expect(status, 'refused, and not with a 500').toBe(409);
      const all = await listProviders(api);
      expect(all.some((p) => p.id === book.def.id), 'still there').toBe(true);
    });

  test('marking another entry default moves the flag rather than adding one',
    async () => {
      await setDefaultProvider(api, csrf, book.role.id);
      const all = await listProviders(api);
      expect(all.filter((p) => p.is_default), 'still exactly one default').toHaveLength(1);
      expect(all.find((p) => p.is_default)?.id).toBe(book.role.id);
      await setDefaultProvider(api, csrf, book.def.id); // restore for the remaining tests
    });
});

// seedProviders —— the default entry (claim already made one; point it at the mock) plus the two
// the overrides use.
async function seedProviders(request: APIRequestContext): Promise<Book> {
  const existing = await listProviders(request);
  const def = existing.find((p) => p.is_default);
  if (!def) throw new Error('claim did not leave a default provider');
  await createProvider(request, csrf, {
    label: 'default-mock', provider: 'anthropic', endpoint: GATEWAY,
    model: MODEL_DEFAULT, key: 'sk-default-00000000', is_default: true,
  });
  const fresh = await listProviders(request);
  return {
    def: fresh.find((p) => p.is_default)!,
    code: await createProvider(request, csrf, {
      label: 'code-mock', provider: 'anthropic', endpoint: GATEWAY,
      model: MODEL_CODE, key: KEY_CODE,
    }),
    role: await createProvider(request, csrf, {
      label: 'role-mock', provider: 'anthropic', endpoint: GATEWAY,
      model: MODEL_ROLE, key: 'sk-role-0000000000',
    }),
  };
}

// turnAndRead —— one visitor turn on `code`, then read back what the gateway received for THIS
// turn (by its own script tag — never "the last request", which under parallel workers belongs to
// whoever ran most recently).
async function turnAndRead(request: APIRequestContext, code: string) {
  const sess = await issueSession(request, { handle: OWNER.handle, code, visitor_name: 'V' });
  const tag = await scriptMockReplyText(request, 'ok');
  await sendMessage(request, sess, `hello${tag}`);
  return lastGatewayRequest(request, tag);
}
