// genre-assets-inherit.spec.ts — an asset **hangs off its article**: visibility is
// purely inherited, it has no rules of its own.
//
// An asset isn't a standalone thing, it belongs to a piece of corpus. So:
//
//	can read the corpus entry  → its assets are reachable too
//	cannot read the corpus entry → none of its assets are reachable, **not even
//	                                knowing the id helps**
//
// That second half is the crux. If an asset had its own retrieval path (swap in an
// address straight from the asset id), that path would bypass the corpus's ACL —
// an owner revoking a wiki entry from a given code, while an image embedded in it
// remains fetchable, makes the revocation fake.
// This is the other half of the same invariant as "a blob's lifetime ⊆ the entry's
// lifetime": **visibility is also ⊆ the entry's visibility**.
//
// # Why only two tests remain here
//
// There used to be four, all asserted via `POST /api/v1/sessions/{id}/tools/corpus_read`.
// That's not the real surface — no visitor ever sends that POST, it's the page's own
// JS that does. And an asset leak **happens at the render layer**: a filename, a
// thumbnail, a broken-image spot that fails to render — any one of these counts as a
// leak, and none of them show up in JSON.
// The two positive-direction tests ("can read → can fetch" / "cannot read → gets
// nothing") are now asserted **in the browser** by genre-assets-reader.spec.ts,
// which is stricter than the JSON assertions here, so those two were deleted rather
// than kept as a weaker duplicate.
//
// The remaining two tests each earn their place here for their own reason — see each
// test's own comment.

import type { APIRequestContext, Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import {
  MEDIA, createEntry, uploadAsset, getEntry, assetByID,
} from '@/fixtures/genre-assets';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'assets-inherit@example.com', password: 'correct-horse-battery-staple',
  handle: 'assets-inherit', fullName: 'Assets Inherit Owner',
};

interface MCPSession { request: APIRequestContext; token: string; sid: string }
let s: MCPSession;
let csrf: string;

test.describe('素材依附文章:可见性纯继承', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    const token = await createAPIToken(request, csrf, 'assets-inherit-token');
    s = { request, token, sid: await initMCP(request, token) };
  });

  test.afterAll(async () => { await s.request.dispose(); });

  // This test **cannot** be driven through the UI, and that's exactly what it's
  // proving: it asserts that a certain path does not exist.
  // There's no button in the interface pointing at a path that doesn't exist —
  // whoever hits it will have opened dev tools, and at that point the HTTP surface
  // is their entry point. So firing this request directly is **the correct shape**,
  // not a shortcut.
  test('知道 asset id 也没用 —— 素材没有绕开文章的第二条路', async () => {
    const id = await createEntry(s, 'wiki', 'no side door', 'body');
    const up = await uploadAsset(s, 'wiki', id, MEDIA.pixel, { filename: 'secret.png' });

    const sess = await sessionScoped(['output://**'], 'sidedoor');
    const status = await assetByID(s.request, sess.session_token, up.asset_id);
    expect([401, 403, 404], `按 id 直取应当不通,got ${status}`).toContain(status);
  });

  // Revocation: same corpus entry, same asset, same id — swap in a code that doesn't
  // grant it, and the visitor's page should have nothing at all.
  // This one goes through the browser — a broken revocation looks like **the image
  // is still rendered on the page**, not like a JSON array still having a value.
  test('文章从范围里被收回后,访客页面上那张图也没了', async ({ page }) => {
    const id = await createEntry(s, 'wiki', 'revoked later', 'body');
    const up = await uploadAsset(s, 'wiki', id, MEDIA.pixel, { filename: 'revoked.png' });
    await setBodyImage(id, up.asset_id);
    const path = (await getEntry(s, 'wiki', id)).path ?? '';

    const [openCode, shutCode] = await issueTwoCodes();

    // The code that grants it: the image is there.
    await enterCodeSession(page, openCode, 'Before');
    await goto(page, `/wiki/${path}`);
    const img = page.getByTestId('wiki-body').locator('img').first();
    await expect(img, '收回之前图渲得出来').toBeVisible({ timeout: 8_000 });
    expect(await img.getAttribute('src') ?? '', '就是那份素材').toContain(up.asset_id);

    // Switch to a code that doesn't grant it: the whole page has no trace of this
    // asset at all.
    await enterCodeSession(page, shutCode, 'After');
    await goto(page, `/wiki/${path}`);
    await expect(page.getByTestId('wiki-locked'), '换一张码就进不去了')
      .toBeVisible({ timeout: 8_000 });
    const html = await page.content();
    expect(html, '连素材 id 都不该出现').not.toContain(up.asset_id);
    expect(html, '文件名也不该漏').not.toContain('revoked.png');
  });
});

async function setBodyImage(id: string, assetID: string): Promise<void> {
  await callTool(s.request, s.token, s.sid, 'corpus.update', {
    genre: 'wiki', id, title: 'revoked later',
    body: `before revoke: ![shot](standmeet-asset:${assetID})`,
  });
}

// issueTwoCodes — one code grants this wiki entry, one doesn't. **The same corpus
// entry**, only the code differs — any difference in outcome can only come from
// visibility, never from "these two entries were already different".
async function issueTwoCodes(): Promise<[string, string]> {
  const open = await codeFor(['wiki://**'], 'open');
  const shut = await codeFor(['output://**'], 'shut');
  return [open, shut];
}

async function codeFor(uris: string[], name: string): Promise<string> {
  const role = await createRole(s.request, csrf, {
    name: `assets-${name}`, description: 'scoped', corpus_uris: uris,
  });
  const code = await createCode(s.request, csrf, {
    code: `ASSETINH-${name.toUpperCase()}`, label: name, assumed_role_id: role.id,
  });
  return code.code;
}

// sessionScoped — issues a code that only grants a given glob, and uses it to open a
// visitor session (for the side-door probe above: it needs a **valid token**, to
// prove that "even with valid credentials, direct fetch by id still doesn't work").
async function sessionScoped(uris: string[], name: string) {
  const code = await codeFor(uris, name);
  return issueSession(s.request, {
    handle: OWNER.handle, mode: 'code', code, visitor_name: name,
  });
}
