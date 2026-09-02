// sync-e-links.spec.ts —— E. body `[[links]]` → note_refs (target-state red, aligned with check-links.sh).
// Resolved by basename across the whole vault (cross-genre); strips `|alias`/`#heading`;
// skips `![[embed]]` + code blocks/inline code; unresolved links are left literal;
// raw/'s `[[]]` isn't forced to resolve (a forward-link is legitimate there).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, adminNoteRefs, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('e');
const md = (body: string): string => makeVaultMD({ publish: true }, body);
const target = { rel: 'wiki/good-regulator-theorem.md', body: makeVaultMD({ publish: true }, 'the theorem') };

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync E · [[links]] → note_refs', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  // ── happy ──
  test('happy: [[slug]] resolves into an outbound edge', slugLink);
  test('happy: [[Title]] resolves by basename', titleLink);
  test('happy: cross-genre link (wiki → subjectivity) by basename', crossGenreLink);
  test('happy: circular [[a]]↔[[b]] yields edges both directions', circularLinks);
  // ── corner ──
  test('corner: [[x|alias]] resolves x, alias stripped', aliasStripped);
  test('corner: [[x#heading]] resolves x, heading stripped', headingStripped);
  test('corner: self-link [[self]] is skipped', selfLinkSkipped);
  // ── error / tolerance ──
  test('error: ![[embed]] is NOT a ref', embedNotRef);
  test('error: [[x]] inside a code fence / inline code is NOT a ref', codeNotRef);
  test('error: unresolved [[ghost]] stays literal (no edge)', unresolvedLiteral);
  test('error: raw/ [[forward-link]] to a nonexistent note is tolerated (no requirement)', rawForwardLink);
});

async function outboundOf(request: APIRequestContext, title: string): Promise<string[]> {
  return (await adminNoteRefs(request, OWNER, 'wiki', title)).outbound;
}

async function slugLink({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [target,
    { rel: 'wiki/ashby.md', body: md('see [[good-regulator-theorem]]') }]);
  expect(await outboundOf(request, 'ashby')).toContain('good-regulator-theorem');
  await request.dispose();
}

async function titleLink({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [target,
    { rel: 'wiki/variety.md', body: md('per [[Good-Regulator-Theorem]] roughly') }]);
  // basename match is case-insensitive (check-links matches basenames; sync resolves title==filename ci).
  expect(await outboundOf(request, 'variety')).toContain('good-regulator-theorem');
  await request.dispose();
}

async function crossGenreLink({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'subjectivity/taste.md', body: md('my taste node') },
    { rel: 'wiki/method.md', body: md('shaped by [[taste]]') },
  ]);
  expect(await outboundOf(request, 'method'), 'wiki → subjectivity edge').toContain('taste');
  await request.dispose();
}

async function circularLinks({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/alpha.md', body: md('links [[beta]]') },
    { rel: 'wiki/beta.md', body: md('links [[alpha]]') },
  ]);
  expect(await outboundOf(request, 'alpha')).toContain('beta');
  expect(await outboundOf(request, 'beta')).toContain('alpha');
  await request.dispose();
}

async function aliasStripped({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [target,
    { rel: 'wiki/al.md', body: md('via [[good-regulator-theorem|the GRT]]') }]);
  expect(await outboundOf(request, 'al')).toContain('good-regulator-theorem');
  await request.dispose();
}

async function headingStripped({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [target,
    { rel: 'wiki/hd.md', body: md('see [[good-regulator-theorem#proof]]') }]);
  expect(await outboundOf(request, 'hd')).toContain('good-regulator-theorem');
  await request.dispose();
}

async function selfLinkSkipped({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/narcissus.md', body: md('I am [[narcissus]]') }]);
  expect(await outboundOf(request, 'narcissus'), 'self-link skipped').not.toContain('narcissus');
  await request.dispose();
}

async function embedNotRef({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [target,
    { rel: 'wiki/em.md', body: md('embed: ![[good-regulator-theorem]]') }]);
  expect(await outboundOf(request, 'em'), 'embed is not a ref').not.toContain('good-regulator-theorem');
  await request.dispose();
}

async function codeNotRef({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [target,
    { rel: 'wiki/cd.md', body: md('inline `[[good-regulator-theorem]]` and\n```\n[[good-regulator-theorem]]\n```') }]);
  expect(await outboundOf(request, 'cd'), 'code [[x]] is not a ref').not.toContain('good-regulator-theorem');
  await request.dispose();
}

async function unresolvedLiteral({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [target,
    { rel: 'wiki/mix.md', body: md('real [[good-regulator-theorem]] and ghost [[does-not-exist]]') }]);
  const out = await outboundOf(request, 'mix');
  expect(out, 'resolved is an edge').toContain('good-regulator-theorem');
  expect(out, 'unresolved stays literal').not.toContain('does-not-exist');
  await request.dispose();
}

async function rawForwardLink({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // raw/ links to a not-yet-written note are intentional — must not error the import.
  const result = await uploadVault(request, OWNER, [
    { rel: 'raw/idea.md', body: makeVaultMD({ tags: ['seed'] }, 'points at [[not-written-yet]]') },
  ]);
  expect(result.errors, 'raw forward-link tolerated').toEqual([]);
  await request.dispose();
}
