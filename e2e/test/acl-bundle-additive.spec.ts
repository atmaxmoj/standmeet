// acl-bundle-additive.spec.ts — the ACL model collapse (design: docs/design/plugin/access-control.md).
//
// RED-by-design. The product rule changes from SUBTRACTIVE (global ∧ role ∧ ¬code-deny) to ADDITIVE:
// the owner assembles a BUNDLE (a list of blocks), the ACL hangs on the bundle, a code binds to a
// bundle BY REFERENCE (the name, not a copy). "What a code can do" is a read of a list, not a
// simulation over layers. Written from the design before any bundle implementation — it is the
// deliberate break access-control.md calls for, and the full additive matrix, not a happy path.
//
// Assertions are black-box (what a visitor session exposes), never internal tables. corpus.retrieval
// and calendar.book are builtin blocks → a granted session shows corpus_search / calendar_book.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession } from '@/fixtures/visitor';
import { sessionToolNames, setBlockEnabled } from '@/fixtures/blocks';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'bundle-acl@example.com', password: 'correct-horse-battery-staple',
  handle: 'bundleowner', fullName: 'Bundle Owner',
};
// Two deps-free builtin blocks that assemble for a fresh owner (no connected supplier, no
// corpus needed) — the same pair block-unmount-is-immediate uses. calendar.book was wrong
// here: it requires:[calendar], so it stays hidden without a connected calendar supplier,
// regardless of bundle membership, and would falsify every grant assertion for a dep reason.
const RETRIEVAL = 'corpus.retrieval';
const RETRIEVAL_TOOL = 'corpus_search';
const BOOK = 'summarize_conversation';
const BOOK_TOOL = 'summarize_conversation';
// A deps-free builtin the fresh owner's role grants but the test bundles never contain —
// the witness for "fell back to the role" (present) vs "constrained to the bundle" (absent).
const ROLE_ONLY_TOOL = 'ask_visitor';

let admin: APIRequestContext;
let csrf = '';

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  admin = await playwright.request.newContext();
  await claim(admin, findSetupToken(), OWNER);
  ({ csrf } = await login(admin, OWNER.email, OWNER.password));
});
test.afterAll(async () => { await admin?.dispose(); });

test.describe('ACL bundle · membership — the session is exactly the bundle\'s list', () => {
  test('a code bound to a bundle exposes exactly the bundle\'s blocks', async () => {
    const b = await createBundle('recruiter', [RETRIEVAL, BOOK]);
    const tools = await toolsForBoundCode('MEMBER', b.id, 'V');
    expect(tools).toContain(RETRIEVAL_TOOL);
    expect(tools).toContain(BOOK_TOOL);
  });

  test('an empty bundle exposes no blocks', async () => {
    const b = await createBundle('empty', []);
    const tools = await toolsForBoundCode('EMPTY', b.id, 'V');
    expect(tools).not.toContain(RETRIEVAL_TOOL);
    expect(tools).not.toContain(BOOK_TOOL);
  });

  test('a bundle with one block exposes only that one', async () => {
    const b = await createBundle('one', [RETRIEVAL]);
    const tools = await toolsForBoundCode('ONE', b.id, 'V');
    expect(tools).toContain(RETRIEVAL_TOOL);
    expect(tools, 'not in the list → absent').not.toContain(BOOK_TOOL);
  });

  // Bundles are opt-in, not mandatory: a code with none keeps the role ACL it always had
  // (access-control.md "A code with no bundle behaves exactly as before"; two models stand
  // side by side). So it is NOT restricted to a bundle's list — it gets the role's grant,
  // which for a fresh owner includes ask_visitor (a builtin the role grants).
  test('a code bound to no bundle falls back to its role grant', async () => {
    const code = await createCode('NO-BUNDLE', undefined);
    const sess = await session(code, 'V');
    const tools = await sessionToolNames(admin, sess);
    expect(tools, 'the role answers when no bundle is bound').toContain(ROLE_ONLY_TOOL);
  });
});

test.describe('ACL bundle · by reference — one bundle edit moves every bound code', () => {
  test('remove a block from the bundle → EVERY bound code loses it at once (by reference)',
    () => runRevocationByReference());

  test('add a block to the bundle → EVERY bound code gains it at once', () => runGrantByReference());
});

test.describe('ACL bundle · nesting', () => {
  test('a bundle that includes another bundle → the session gets the union', async () => {
    const base = await createBundle('base', [RETRIEVAL]);
    const outer = await createBundle('outer', [BOOK], [base.id]);
    const tools = await toolsForBoundCode('NEST', outer.id, 'V');
    expect(tools).toContain(BOOK_TOOL);
    expect(tools, 'included bundle\'s block, by reference').toContain(RETRIEVAL_TOOL);
  });

  test('a block reached both directly and through a nested bundle appears once, not twice',
    async () => {
      const base = await createBundle('dup-base', [RETRIEVAL]);
      const outer = await createBundle('dup-outer', [RETRIEVAL, BOOK], [base.id]);
      const tools = await toolsForBoundCode('DUP', outer.id, 'V');
      expect(tools.filter((t) => t === RETRIEVAL_TOOL).length, 'deduped').toBe(1);
    });

  test('a bundle include-cycle is refused at write (A→B→A never creates)', async () => {
    const a = await createBundle('cyc-a', [RETRIEVAL]);
    const b = await createBundle('cyc-b', [BOOK], [a.id]);
    const status = await setBundleIncludesStatus(a.id, [b.id]); // would close the loop
    expect(status, 'a cycle is a client error, not accepted').toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

test.describe('ACL bundle · master rules (live edit / owner-disable / delete)', () => {
  // Contents stay live (access-control.md "the name, not the contents … contents stay live";
  // block-model.md's immediate unmount — no frozen-at-issue model). Editing the bundle a code
  // is bound to bites the OPEN session at once, which is the by-reference property on a live
  // session and what an owner revoking access in a hurry needs. (block-unmount-is-immediate
  // pins the same rule from the GUI side.)
  test('a live session sees a bundle edit at once (contents stay live)',
    () => runLiveBundleEdit());

  // ── the "mounted, or not" master still wins over bundle membership ──
  test('owner-disabling a block removes it even while it is in the bundle', async () => {
    const b = await createBundle('with-disabled', [RETRIEVAL, BOOK]);
    expect(await setBlockEnabled(admin, csrf, BOOK, false)).toBe(200);
    const tools = await toolsForBoundCode('DISABLED', b.id, 'V');
    expect(tools, 'disabled beats bundle membership').not.toContain(BOOK_TOOL);
    expect(tools, 'the enabled sibling still shows').toContain(RETRIEVAL_TOOL);
    await setBlockEnabled(admin, csrf, BOOK, true);
  });

  // ── deleting the bundle a code is bound to re-gates it to the role ──
  // access-control.md / bundles.delete: a deleted bundle does not revoke its codes; the
  // binding clears (ON DELETE SET NULL) and each code falls back to its role's grant. The
  // proof is that a role-only tool the bundle did NOT grant appears after the delete.
  test('deleting a bundle re-gates every bound code to its role', async () => {
    const b = await createBundle('doomed', [RETRIEVAL, BOOK]);
    const code = await createCode('DOOMED', b.id);
    const bound = await sessionToolNames(admin, await session(code, 'B'));
    expect(bound, 'bundle-bound: has the bundle block').toContain(BOOK_TOOL);
    expect(bound, 'bundle-bound: NOT the role tools outside the bundle')
      .not.toContain(ROLE_ONLY_TOOL);
    await deleteBundle(b.id);
    const after = await sessionToolNames(admin, await session(code, 'A'));
    expect(after, 're-gated to the role, which grants it').toContain(ROLE_ONLY_TOOL);
  });
});

// ─── test bodies (top-level so each describe callback stays within the line budget) ───

async function runRevocationByReference(): Promise<void> {
  const b = await createBundle('shared-rm', [RETRIEVAL, BOOK]);
  const a = await createCode('REF-A', b.id);
  const c = await createCode('REF-B', b.id);
  expect(await sessionToolNames(admin, await session(a, 'A'))).toContain(BOOK_TOOL);
  expect(await sessionToolNames(admin, await session(c, 'B'))).toContain(BOOK_TOOL);
  await setBundleBlocks(b.id, [RETRIEVAL]);
  expect(await sessionToolNames(admin, await session(a, 'A2')),
    'code A lost it').not.toContain(BOOK_TOOL);
  expect(await sessionToolNames(admin, await session(c, 'B2')),
    'code B lost it too — one edit, both codes').not.toContain(BOOK_TOOL);
  expect(await sessionToolNames(admin, await session(a, 'A3')), 'kept block stays').toContain(RETRIEVAL_TOOL);
}

async function runGrantByReference(): Promise<void> {
  const b = await createBundle('shared-add', [RETRIEVAL]);
  const a = await createCode('ADD-A', b.id);
  const c = await createCode('ADD-B', b.id);
  expect(await sessionToolNames(admin, await session(a, 'A')), 'not yet').not.toContain(BOOK_TOOL);
  await setBundleBlocks(b.id, [RETRIEVAL, BOOK]);
  expect(await sessionToolNames(admin, await session(a, 'A2')), 'A gained it').toContain(BOOK_TOOL);
  expect(await sessionToolNames(admin, await session(c, 'B2')), 'B gained it too').toContain(BOOK_TOOL);
}

async function runLiveBundleEdit(): Promise<void> {
  const b = await createBundle('live-edit', [RETRIEVAL, BOOK]);
  const code = await createCode('LIVE', b.id);
  const live = await session(code, 'L');
  expect(await sessionToolNames(admin, live)).toContain(BOOK_TOOL);
  await setBundleBlocks(b.id, [RETRIEVAL]);
  expect(await sessionToolNames(admin, live),
    'the bundle is read live — the open session loses the removed block at once')
    .not.toContain(BOOK_TOOL);
  expect(await sessionToolNames(admin, live), 'the kept block stays').toContain(RETRIEVAL_TOOL);
}

// ─── helpers (hit the DESIGNED bundle endpoints — RED until they exist) ───

interface Bundle { id: string }

async function toolsForBoundCode(code: string, bundleID: string, name: string): Promise<string[]> {
  const c = await createCode(code, bundleID);
  return sessionToolNames(admin, await session(c, name));
}

async function session(code: string, name: string): Promise<string> {
  const s = await issueSession(admin, { handle: OWNER.handle, mode: 'code', code, visitor_name: name });
  return s.session_token;
}

async function createBundle(
  name: string, blocks: string[], includeBundles: string[] = [],
): Promise<Bundle> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: bundle assembly, the additive-ACL feature this spec drives
  const res = await admin.post(`${BACKEND}/api/admin/bundles`, {
    headers: { 'X-Csrftoken': csrf }, data: { name, blocks, include_bundles: includeBundles },
  });
  if (res.status() !== 201) throw new Error(`create bundle ${name}: ${res.status()}`);
  return await res.json() as Bundle;
}

async function setBundleBlocks(bundleID: string, blocks: string[]): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: editing a bundle's ACL, the by-reference revocation this spec drives
  const res = await admin.post(`${BACKEND}/api/admin/bundles/${bundleID}/blocks`, {
    headers: { 'X-Csrftoken': csrf }, data: { blocks },
  });
  if (res.status() !== 200) throw new Error(`set bundle blocks: ${res.status()}`);
}

async function setBundleIncludesStatus(bundleID: string, includeBundles: string[]): Promise<number> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: nesting bundles by reference; a cycle must be refused
  const res = await admin.post(`${BACKEND}/api/admin/bundles/${bundleID}/includes`, {
    headers: { 'X-Csrftoken': csrf }, data: { include_bundles: includeBundles },
  });
  return res.status();
}

async function deleteBundle(bundleID: string): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: deleting a bundle re-gates its bound codes
  const res = await admin.post(`${BACKEND}/api/admin/bundles/${bundleID}/delete`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  if (res.status() !== 200) throw new Error(`delete bundle: ${res.status()}`);
}

async function createCode(code: string, bundleID: string | undefined): Promise<string> {
  const data: Record<string, unknown> = { code, label: `code ${code}` };
  if (bundleID) data['bundle_id'] = bundleID;
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: binding a code to a bundle by reference this spec drives
  const res = await admin.post(`${BACKEND}/api/admin/codes`, {
    headers: { 'X-Csrftoken': csrf }, data,
  });
  if (res.status() !== 201) throw new Error(`create code ${code}: ${res.status()}`);
  return code;
}
