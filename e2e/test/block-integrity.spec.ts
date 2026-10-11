// block-integrity.spec.ts —— roadmap 7.2.a: installed blocks are the ones I approved.
//
// Contract (blocks.marketplace_install):
//   - The tarball's bytes are checked against the registry's published dist.integrity. Bytes that
//     do not match are refused, and nothing is installed.
//   - The install stores the integrity the owner approved. Installing the same block again with
//     different contents (a republish) is refused until the owner passes accept_change: true.
//   - The same contents install again without a question.
// Package: the npm mock's @deepseek-ai/cordis-plugin-integrity (block dshintegritydemo), changed by
// /__mock/npm/republish and /__mock/npm/corrupt — never the demo package a parallel spec installs.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login } from '@/fixtures/admin';
import { findBlock } from '@/fixtures/blocks';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { MOCK_BASE } from '@/fixtures/jobs';
import { callToolOutcome, initMCP } from '@/fixtures/mcp';

const PKG = '@deepseek-ai/cordis-plugin-integrity';
const BLOCK = 'dshintegritydemo';
const OWNER = {
  email: 'integrity@example.com', password: 'correct-horse-battery-staple',
  handle: 'integrity', fullName: 'Integrity Owner',
};

let admin: APIRequestContext;
let csrf = '';
let token = '';
let sid = '';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  admin = await playwright.request.newContext();
  await claim(admin, findSetupToken(), OWNER);
  ({ csrf } = await login(admin, OWNER.email, OWNER.password));
  token = await createAPIToken(admin, csrf, 'integrity');
  sid = await initMCP(admin, token);
});
test.afterAll(async () => { await admin?.dispose(); });

function install(extra: Record<string, unknown> = {}) {
  return callToolOutcome(admin, token, sid, 'blocks.marketplace_install', { id: PKG, ...extra });
}

async function mock(path: string): Promise<void> {
  const res = await admin.post(`${MOCK_BASE}/__mock/npm/${path}`);
  if (!res.ok()) throw new Error(`mock npm ${path}: ${res.status()}`);
}

test('7.2.a — the approved package installs, and installs again without a question', async () => {
  const first = await install();
  expect(first.isError, first.text).toBe(false);
  expect(await findBlock(admin, csrf, BLOCK), 'presence: it is mounted').toBeDefined();
  const again = await install();
  expect(again.isError, 'same contents, no question').toBe(false);
});

test('7.2.a — new contents under the same block need the owner\'s yes', async () => {
  await mock('republish');
  const refused = await install();
  expect(refused.isError).toBe(true);
  expect(refused.text).toMatch(/changed since you installed it/);
  expect(refused.text).toMatch(/accept_change/);
  const approved = await install({ accept_change: true });
  expect(approved.isError, approved.text).toBe(false);
  const after = await install();
  expect(after.isError, 'the new contents are now the approved ones').toBe(false);
});

test('7.2.a — bytes that do not match the published integrity are refused', async () => {
  await mock('corrupt');
  const refused = await install({ accept_change: true });
  expect(refused.isError).toBe(true);
  expect(refused.text).toMatch(/does not match the integrity/);
});
