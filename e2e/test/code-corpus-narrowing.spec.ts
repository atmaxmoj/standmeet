// code-corpus-narrowing.spec.ts -- the **code layer** of the corpus class among the three
// ACL classes (capability/skill have had it for a while; corpus was previously missing).
//
// The owner's scenario, verbatim: a CV is not public, then gets targeted access via role
// and code -- a recruiter's code can see it, other codes cannot. The role grants the
// allow-list of what "this audience" can read; the code then subtracts what "this
// particular invite" should not see.
//
// The role here **deliberately** grants `subjectivity://**` (which includes the CV): if
// the role simply didn't grant it, this test could pass without the feature existing.
// What actually needs proving is "the role granted it, but this code took it back".

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  BACKEND, claimSyncOwner, syncOwner, syncSession, syncRead, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
type PageCtx = { adminPage: Page };
const OWNER: SyncOwner = syncOwner('codecorpus');

// EMPLOYER -- a stand-in for PII in the CV. Every assertion looks for **this exact
// string**, not for "did it error".
const EMPLOYER = 'ACMECORP-CONFIDENTIAL-EMPLOYER';

const VAULT = [
  {
    rel: 'subjectivity/cv.md',
    body: makeVaultMD({ tags: ['fact', 'cv'] }, `Sijie Wang. Worked at ${EMPLOYER}. Lives in Shanghai.`),
  },
  {
    rel: 'subjectivity/standpoint.md',
    body: makeVaultMD({ tags: ['node'] }, 'A collaboration needs a seat that can arbitrate.'),
  },
];

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('ACL · per-code corpus narrowing (role grants, this code takes back)', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER); // grants subjectivity://** ON PURPOSE
    await uploadVault(request, OWNER, VAULT, { authoritative: true });
    await request.dispose();
  });

  test('inherits the role grant when the code takes nothing back', inheritsByDefault);
  test('owner narrows the code from the panel; the box shows what the role granted',
    narrowsFromThePanel);
  test('a code that takes back subjectivity://cv cannot read it', codeNarrows);
  test('…while the rest of the role grant still reads on that same code', narrowingIsSurgical);
  test('a denial cannot OPEN what the role never granted', denyCannotOpen);
});

// setDenied -- the owner takes back a set of globs on this code (the real admin route;
// the UI hits the same one).
async function setDenied(
  request: APIRequestContext, codeID: string, denied: string[],
): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const res = await request.put(`${BACKEND}/api/admin/codes/${codeID}/denials/corpus`, {
    headers: { 'X-Csrftoken': csrf },
    data: { uris: denied },
  });
  expect(res.status(), 'owner can narrow a code').toBe(200);
}

async function codeIDOf(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const res = await request.get(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf },
  });
  const codes = await res.json() as Array<{ id: string; code: string }>;
  return codes[0]?.id ?? '';
}

// inheritsByDefault -- the backward-compatibility floor: an existing code with zero deny
// rows must behave exactly as before, verbatim.
async function inheritsByDefault({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const read = await syncRead(request, await syncSession(request, OWNER), 'cv');
  expect(read.body ?? '', 'no denials → the role grant stands').toContain(EMPLOYER);
  await request.dispose();
}

// narrowsFromThePanel -- the place the owner actually does this is **the box on the
// card**, not curl. The tests above all hit the API directly, so this box itself (what it
// reads, what it writes, whether it persists after save) has never been verified.
// This asserts the good outcome: the inherited allow-list is printed in the box, the
// visitor really can't read it after saving, and the takeback list still shows after a
// reload.
async function narrowsFromThePanel({ adminPage, playwright }: Ctx & PageCtx): Promise<void> {
  await gotoAdminSection(adminPage, 'codes');
  const box = adminPage.getByTestId('code-corpus-SYNC-ALL');
  await expect(box).toBeVisible({ timeout: 10_000 });
  await expect(box, 'the role grant is shown for comparison').toContainText('subjectivity://**');

  await box.getByTestId('code-corpus-denied-SYNC-ALL').fill('subjectivity://cv');
  await box.getByTestId('code-corpus-save-SYNC-ALL').click();
  await expect(adminPage.getByText(/corpus narrowed for SYNC-ALL/i)).toBeVisible();

  const request = await playwright.request.newContext();
  const read = await syncRead(request, await syncSession(request, OWNER), 'cv');
  expect(read.body ?? '', 'saving from the panel really takes it back').not.toContain(EMPLOYER);
  await request.dispose();

  await adminPage.reload();
  await gotoAdminSection(adminPage, 'codes');
  await expect(
    adminPage.getByTestId('code-corpus-denied-SYNC-ALL'),
    'what the owner saved is what the box reads back',
  ).toHaveValue('subjectivity://cv');
}

// codeNarrows -- the core case: the role grants subjectivity://**, this code takes back
// cv -> can't read it, and the PII doesn't come back.
async function codeNarrows({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await setDenied(request, await codeIDOf(request), ['subjectivity://cv']);

  const read = await syncRead(request, await syncSession(request, OWNER), 'cv');
  expect(read.body ?? '', 'the PII body must not come back').not.toContain(EMPLOYER);
  expect(read.error ?? '', 'the code took it back → not-found/denied').toMatch(
    /not found|access denied/i,
  );
  await request.dispose();
}

// narrowingIsSurgical -- narrowing only removes that one entry. Without this control,
// "blocking the PII" could also be achieved by the whole subjectivity retrieval breaking
// -- that would be a false green.
async function narrowingIsSurgical({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await setDenied(request, await codeIDOf(request), ['subjectivity://cv']);

  const read = await syncRead(request, await syncSession(request, OWNER), 'standpoint');
  expect(read.genre, 'the rest of the grant is untouched').toBe('subjectivity');
  expect(read.body ?? '').toContain('arbitrate');
  await request.dispose();
}

// denyCannotOpen -- A.4's iron rule: a code can only subtract. Naming a glob the role
// never granted in the takeback list does not open it up.
async function denyCannotOpen({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // output:// is not in this owner's role grant; naming it in DENY must not grant it.
  await setDenied(request, await codeIDOf(request), ['output://**']);

  const read = await syncRead(request, await syncSession(request, OWNER), 'standpoint');
  expect(read.genre, 'an unrelated denial changes nothing about what IS granted').toBe('subjectivity');
  await request.dispose();
}
