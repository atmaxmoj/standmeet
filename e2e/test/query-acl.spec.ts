// query-acl.spec.ts —— 原生查询的 ACL(目标态红,安全核心)。查询走现成 ACL-scoped CorpusLister,
// 所以结果**只能是 reader 有权看的条目** —— owner-only genre(subjectivity)绝不能被一个只授 wiki 的
// 访客通过 query 列出来。这是这个特性最重要的不变量:**查询不能当越权枚举的 oracle**。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, syncSession, syncRead, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('qa');

function queryBlock(dsl: string): string {
  return '```standmeet-query\n' + dsl + '\n```';
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('native corpus query · ACL', () => {
  // reader is granted ONLY wiki:// — subjectivity is owner-only and out of scope.
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER, ['wiki://**']);
    await request.dispose();
  });

  test('a cross-genre tag query returns ONLY the granted genre (wiki), never subjectivity', noGenreLeak);
  test('a query explicitly targeting an owner-only genre returns nothing (no oracle)', ownerOnlyGenreEmpty);
  test('positive control: the wiki match IS present (ACL isn’t just returning empty)', positiveControl);
});

async function seed(request: APIRequestContext): Promise<void> {
  await uploadVault(request, OWNER, [
    { rel: 'wiki/pub-a.md', body: makeVaultMD({ publish: true, tags: ['t'] }, 'public a') },
    { rel: 'wiki/pub-b.md', body: makeVaultMD({ publish: true, tags: ['t'] }, 'public b') },
    // owner-only: a subjectivity note also tagged 't' — must NEVER surface for a wiki-only reader.
    { rel: 'subjectivity/secret.md', body: makeVaultMD({ publish: true, tags: ['t'] }, 'SECRETLEAKKW') },
    { rel: 'wiki/idx.md', body: makeVaultMD({ publish: true }, queryBlock('tag: t\nsort: title')) },
    { rel: 'wiki/subj-idx.md', body: makeVaultMD({ publish: true }, queryBlock('genre: subjectivity\ntag: t')) },
  ]);
}

async function bodyOf(request: APIRequestContext, path: string): Promise<string> {
  const sess = await syncSession(request, OWNER);
  return (await syncRead(request, sess, path)).body ?? '';
}

async function noGenreLeak({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await seed(request);
  const body = await bodyOf(request, 'idx');
  expect(body, 'granted wiki match present').toContain('pub-a');
  expect(body, 'owner-only subjectivity NEVER leaks via query').not.toContain('secret');
  expect(body, 'no subjectivity body leak').not.toContain('SECRETLEAKKW');
  await request.dispose();
}

async function ownerOnlyGenreEmpty({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await seed(request);
  const body = await bodyOf(request, 'subj-idx');
  expect(body, 'querying an ungranted genre yields no rows (no enumeration oracle)').not.toContain('secret');
  expect(body).not.toContain('SECRETLEAKKW');
  await request.dispose();
}

async function positiveControl({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await seed(request);
  const body = await bodyOf(request, 'idx');
  // guard against a false-green where ACL just empties everything: the granted match must show.
  expect(body).toContain('pub-a');
  expect(body).toContain('pub-b');
  await request.dispose();
}
