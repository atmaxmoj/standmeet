// security-block-isolation-adversarial.spec.ts — the isolation boundaries a malicious block must
// not cross, proven by a purpose-built ADVERSARY block that actively tries each attack variant
// (red-first: every attack must be observably REFUSED, not merely "no error").
//
// The eiab thesis leans on structural isolation: each reach-back block authenticates to the host
// with its OWN native key (bound to its trusted id, name not computable, dead after unmount); the
// sandbox has NO network but its own host socket; each storing block's data is its OWN db schema
// (mcp_<id>). This spec makes each claim falsifiable by shipping a block whose tools deliberately
// attempt the full attack surface, and asserting each attempt fails and leaks nothing.
//
// RED-by-design until the adversary fixture block (a block whose tools each mount one attack) is
// mounted and confinement holds. Decoupled from HOW confinement is implemented (bwrap / native-key
// issuer / schema keying) — it asserts only the observable outcome: the attack does not succeed.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession } from '@/fixtures/visitor';
import { runToolAndRead } from '@/fixtures/mock-llm-script';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'adversary@example.com', password: 'correct-horse-battery-staple',
  handle: 'advowner', fullName: 'Adversary Owner',
};

interface Attack { tool: string; desc: string }
interface AttackOut { blocked?: boolean; [k: string]: unknown }

// native-key: the reach-back credential. A block must not obtain, guess, reuse, or impersonate with
// another block's key — the host binds the key to the trusted calling id.
const NATIVE_KEY_ATTACKS: Attack[] = [
  { tool: 'adversary_forge_native_key', desc: 'present a fabricated native key' },
  { tool: 'adversary_steal_sibling_key_by_id', desc: 'fetch a sibling fiber’s key by id (no get-by-id)' },
  { tool: 'adversary_guess_key_name', desc: 'compute/guess a sibling’s key name (not computable)' },
  { tool: 'adversary_reuse_post_unmount_key', desc: 'reuse a key after its block was unmounted' },
  { tool: 'adversary_present_other_identity', desc: 'call the host claiming another block’s id' },
];

// socket: the sandbox has no network beyond its own host socket. A block must not reach a sibling’s
// reach-back socket (the path is host-derived from the trusted id) or the network at large.
const SOCKET_ATTACKS: Attack[] = [
  { tool: 'adversary_dial_sibling_socket', desc: 'dial a sibling block’s reach-back socket' },
  { tool: 'adversary_enumerate_sockets', desc: 'enumerate/guess sibling socket paths' },
  { tool: 'adversary_reach_network', desc: 'reach any network endpoint other than its host socket' },
];

// db cross-schema: a storing block’s data is confined to mcp_<its-own-id>. It must not read, write,
// enumerate, drop, or forge access to another block’s schema.
const SCHEMA_ATTACKS: Attack[] = [
  { tool: 'adversary_set_search_path', desc: 'SET search_path to a sibling schema' },
  { tool: 'adversary_enumerate_schemas', desc: 'enumerate schemas via information_schema/pg_catalog' },
  { tool: 'adversary_drop_foreign_schema', desc: 'DROP a schema it did not open' },
  { tool: 'adversary_query_forged_schema', desc: 'read rows from a forged sibling schema name' },
];

test.describe('security · a malicious block cannot cross the isolation boundaries', () => {
  let admin: APIRequestContext;
  let sessionToken = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    admin = await playwright.request.newContext();
    await claim(admin, findSetupToken(), OWNER);
    const { csrf } = await login(admin, OWNER.email, OWNER.password);
    await installAdversaryBlock(admin, csrf);
    const allTools = [...NATIVE_KEY_ATTACKS, ...SOCKET_ATTACKS, ...SCHEMA_ATTACKS].map((a) => a.tool);
    const code = await issueAdversaryCode(admin, csrf, allTools);
    const sess = await issueSession(admin,
      { handle: OWNER.handle, mode: 'code', code, visitor_name: 'V' });
    sessionToken = sess.session_token;
  });
  test.afterAll(async () => { await admin?.dispose(); });

  test.describe('native-key: cannot obtain, guess, reuse, or impersonate another block’s key', () => {
    for (const atk of NATIVE_KEY_ATTACKS) {
      test(atk.desc, async () => { await expectRefused(admin, sessionToken, atk); });
    }
  });

  test.describe('socket: sandbox reaches only its own host socket, nothing else', () => {
    for (const atk of SOCKET_ATTACKS) {
      test(atk.desc, async () => { await expectRefused(admin, sessionToken, atk); });
    }
  });

  test.describe('db: a block’s storage is confined to its own schema', () => {
    for (const atk of SCHEMA_ATTACKS) {
      test(atk.desc, async () => { await expectRefused(admin, sessionToken, atk); });
    }
  });
});

// expectRefused — run one attack tool and assert the host refused it (blocked:true) and no sibling
// secret/identifier came back in the payload.
async function expectRefused(
  request: APIRequestContext, sessionToken: string, atk: Attack,
): Promise<void> {
  const out = await runToolAndRead(request, sessionToken, atk.tool, {}) as AttackOut;
  expect(out.blocked, `attack refused: ${atk.desc}`).toBe(true);
  expect(JSON.stringify(out), `no sibling secret leaked: ${atk.desc}`)
    .not.toMatch(/secret|token|password|native_key|BEGIN [A-Z]+ KEY/i);
}

// ─── helpers (drive the test-only adversary fixture — RED until it exists) ───

async function installAdversaryBlock(request: APIRequestContext, csrf: string): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: mount the adversary fixture block this security spec drives
  const res = await request.post(`${BACKEND}/api/admin/blocks/install-fixture`, {
    headers: { 'X-Csrftoken': csrf }, data: { fixture: 'adversary' },
  });
  if (res.status() !== 201 && res.status() !== 200) {
    throw new Error(`install adversary fixture: ${res.status()}`);
  }
}

async function issueAdversaryCode(
  request: APIRequestContext, csrf: string, tools: string[],
): Promise<string> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: grant the adversary block's attack tools to a visitor code this spec drives
  const res = await request.post(`${BACKEND}/api/admin/codes`, {
    headers: { 'X-Csrftoken': csrf },
    data: { code: 'ADVERSARY-1', label: 'adversary', granted_skills: tools },
  });
  if (res.status() !== 201) throw new Error(`issue adversary code: ${res.status()}`);
  return 'ADVERSARY-1';
}
