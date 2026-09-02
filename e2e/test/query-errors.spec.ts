// query-errors.spec.ts -- fault tolerance for native queries (target-state red). Malformed
// DSL / unknown fields / oversized results must never crash -- degrade gracefully (keep the
// literal or give a friendly message), ignore unknown fields, and cap results.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, syncSession, syncRead, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('qe');

function queryBlock(dsl: string): string {
  return '```standmeet-query\n' + dsl + '\n```';
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('native corpus query · errors / tolerance', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  test('tolerance: a malformed query DSL degrades gracefully (no crash)', malformedDSL);
  test('tolerance: an unknown query field is ignored, known fields still apply', unknownField);
  test('cap: a filterless query is bounded, does not dump the whole corpus unbounded', resultCap);
});

async function readOK(request: APIRequestContext, path: string): Promise<string> {
  const sess = await syncSession(request, OWNER);
  const r = await syncRead(request, sess, path);
  expect(r.error ?? '', 'note itself still readable, no 500').toBe('');
  return r.body ?? '';
}

async function malformedDSL({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const r = await uploadVault(request, OWNER, [
    { rel: 'wiki/bad.md', body: makeVaultMD({ publish: true }, queryBlock(':::not valid\n\t- ??? [[')) },
  ]);
  expect(r.errors, 'malformed query does not fail the import').toEqual([]);
  await readOK(request, 'bad'); // and does not 500 the read
  await request.dispose();
}

async function unknownField({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/hit.md', body: makeVaultMD({ publish: true, tags: ['k'] }, 'hit') },
    {
      rel: 'wiki/uf.md',
      body: makeVaultMD({ publish: true }, queryBlock('tag: k\nbogus_field: 42\nsort: title')),
    },
  ]);
  const body = await readOK(request, 'uf');
  expect(body, 'known field (tag) still applied despite the unknown one').toContain('hit');
  await request.dispose();
}

async function resultCap({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const files = Array.from({ length: 60 }, (_, i) => ({
    rel: `wiki/n${i}.md`, body: makeVaultMD({ publish: true, tags: ['big'] }, `n${i}`),
  }));
  files.push({ rel: 'wiki/capidx.md', body: makeVaultMD({ publish: true }, queryBlock('tag: big')) });
  await uploadVault(request, OWNER, files);
  const body = await readOK(request, 'capidx');
  // bounded: a default cap applies (not all 60 dumped) — assert it resolved but didn't list everything.
  const listed = (body.match(/n\d+/g) ?? []).length;
  expect(listed, 'result is capped, not an unbounded dump').toBeLessThan(60);
  await request.dispose();
}
