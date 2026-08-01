// code-corpus-narrowing.spec.ts —— ACL 三类里的 corpus 那类的 **code 层**（capability/skill 早有，
// corpus 之前缺席）。
//
// owner 的场景，逐字：CV 不 public，然后在 role 和 code 上定向开放 —— 招聘方的码看得到，别人的
// 码看不到。role 授「这个受众」能读的正列表，code 再减「这一次邀约」不该看的。
//
// 这里的 role **故意**授 `subjectivity://**`（含 CV）：如果 role 干脆不授，这条测试不需要功能存在
// 就能过。真正要证的是「role 授了，但这张码收回了」。

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

// EMPLOYER —— CV 里的 PII 替身。每条断言都在找**这个字符串**，而不是找"报错了没"。
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

// setDenied —— owner 在这张码上收回一组 glob（真 admin 路由，UI 打的是同一条）。
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

// inheritsByDefault —— 向后兼容的地板：既有的码一行 deny 都没有，行为必须逐字不变。
async function inheritsByDefault({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const read = await syncRead(request, await syncSession(request, OWNER), 'cv');
  expect(read.body ?? '', 'no denials → the role grant stands').toContain(EMPLOYER);
  await request.dispose();
}

// narrowsFromThePanel —— owner 真正做这件事的地方是**卡片上那个框**，不是 curl。
// 上面几条都直接打 API，于是这个框自己（读什么、写什么、存完还在不在）一直没人验过。
// 断言的是好结果：继承来的正列表印在框里、存完访客真的读不到、刷新后收回列表还在。
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

// codeNarrows —— 核心：role 授了 subjectivity://**，这张码收回 cv → 读不到，且 PII 不回来。
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

// narrowingIsSurgical —— 收窄只拿掉那一条。没有这个控制，"把 PII 挡住"也可以靠整个 subjectivity
// 检索坏掉来实现 —— 那会是假的绿。
async function narrowingIsSurgical({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await setDenied(request, await codeIDOf(request), ['subjectivity://cv']);

  const read = await syncRead(request, await syncSession(request, OWNER), 'standpoint');
  expect(read.genre, 'the rest of the grant is untouched').toBe('subjectivity');
  expect(read.body ?? '').toContain('arbitrate');
  await request.dispose();
}

// denyCannotOpen —— A.4 的铁律：code 只能减。收回列表里提到一个 role 没授的 glob，不会把它开开。
async function denyCannotOpen({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // output:// is not in this owner's role grant; naming it in DENY must not grant it.
  await setDenied(request, await codeIDOf(request), ['output://**']);

  const read = await syncRead(request, await syncSession(request, OWNER), 'standpoint');
  expect(read.genre, 'an unrelated denial changes nothing about what IS granted').toBe('subjectivity');
  await request.dispose();
}
