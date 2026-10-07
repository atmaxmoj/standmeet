// mcp-key-scopes.spec.ts —— an owner MCP key can be limited to the classes of operation it may use.
//
// Refactor ledger R7 (2026-10-06): any valid keypair was the whole instance — a key pasted into a
// third-party AI client could delete the corpus, mint keys, change who reads what, or upgrade the
// instance. A key now carries scopes, the danger classes it may use (R8 classifies every op); the
// owner MCP face lists only the tools in scope and refuses a call outside it. A key created without
// scopes keeps every class, so keys already handed out behave as before.

import type { APIRequestContext } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callToolOutcome, initMCP, listTools } from '@/fixtures/mcp';
import { listKeypairs } from '@/fixtures/keypair';

const OWNER = {
  email: 'key-scopes@example.com', password: 'correct-horse-battery-staple',
  handle: 'keyscopes', fullName: 'Key Scopes Owner',
};

let readOnly = '';
let full = '';
let csrfToken = '';
let admin: APIRequestContext;

test.describe('an MCP key only reaches the classes it is scoped for', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    admin = await playwright.request.newContext();
    await claim(admin, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(admin, OWNER.email, OWNER.password);
    csrfToken = csrf;
    readOnly = await createAPIToken(admin, csrf, 'reader', ['read']);
    full = await createAPIToken(admin, csrf, 'everything');
  });

  test.afterAll(async () => { await admin.dispose(); });

  test('a read-only key lists reads only', async ({ request }) => {
    const sid = await initMCP(request, readOnly);
    const names = (await listTools(request, readOnly, sid)).map((t) => t.name);
    expect(names, 'reads are there').toEqual(expect.arrayContaining(['corpus.get', 'corpus.map']));
    for (const n of ['corpus.delete', 'corpus.create', 'codes.create', 'api_keys.create', 'instance.upgrade']) {
      expect(names, `${n} is not offered to a read-only key`).not.toContain(n);
    }
  });

  test('a read-only key calling a delete is refused, and says why', async ({ request }) => {
    const sid = await initMCP(request, readOnly);
    const out = await callToolOutcome(request, readOnly, sid, 'corpus.delete',
      { genre: 'wiki', id: '00000000-0000-0000-0000-000000000000' });
    expect(out.isError, 'refused').toBe(true);
    expect(out.text).toMatch(/not allowed|scope/i);
    expect(out.text).toContain('destructive');
  });

  test('a key created without scopes keeps every class', async ({ request }) => {
    const sid = await initMCP(request, full);
    const names = (await listTools(request, full, sid)).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['corpus.delete', 'codes.create', 'corpus.map']));
  });

  test('the key list says what each key may do', async () => {
    const keys = await listKeypairs(admin, csrfToken);
    const reader = keys.find((k) => k.label === 'reader');
    expect(reader?.scopes).toEqual(['read']);
    const everything = keys.find((k) => k.label === 'everything');
    expect(everything?.scopes).toEqual(
      ['read', 'write', 'destructive', 'credential', 'authority', 'spend', 'egress']);
  });
});
