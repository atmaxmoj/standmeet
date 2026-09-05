// microsite-is-the-codes-rendering.spec.ts -- **pages give a code a rendering**.
//
// A code can be bound to a microsite. Once bound, nothing about the code itself
// changes: the same grant, the same role, the same quota, the same accounting -- the
// only thing that changes is the sheet of paper in front of the reader. So what this
// file asserts is never "the page supports some feature", it's "**what would give it
// license to behave differently from chat**", and the answer must always be nothing.
//
// The whole criterion lives **on the page**. If the backend is right but the page opens
// its own separate anonymous session, nothing on screen looks different: the name, the
// quota, the turn count all silently come up empty, while the reader keeps getting
// normal-looking answers ([[test-covers-capability-not-face]]).
//
// Covers: landing (what you scan into is that page) - accounting (the conversation
// posts to that code) - inheritance (name/quota/turns/revocation) - admission (carrying
// a code stops it from also asking for a bring-your-own key).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login } from '@/fixtures/admin';
import { createCode, revokeCode } from '@/fixtures/codes';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { MEDIA, uploadAsset } from '@/fixtures/genre-assets';
import { initMCP } from '@/fixtures/mcp';
import { bindCodeToPage, publishPage, setPageByoai } from '@/fixtures/microsite-rig';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'page-rendering@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'rendering',
  fullName: 'Rendering Owner',
};

interface Admin { request: APIRequestContext; csrf: string }

// Every test case has to build a page for real (a sandboxed vite process, **one build
// at a time**, and several in this family end up queued), so the default 30s budget
// isn't enough. What's being widened is the **queue wait**, not tolerance for a build
// that might never finish: the poll itself still has a 180s deadline, and a timeout is
// still red.
const BUILD_BUDGET_MS = 240_000;

async function freshOwner(playwright: Playwright): Promise<Admin> {
  test.setTimeout(BUILD_BUDGET_MS);
  resetInstance();
  const request = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  return { request, csrf };
}

// enterWithCode -- enters with a code -> fills the name picker -> submits. **Doesn't
// specify a destination**: where it lands is the product's own decision, this helper
// only carries out the code-claiming step.
async function enterWithCode(page: Page, code: string, name: string): Promise<void> {
  await goto(page, `/?code=${code}`);
  const issued = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 20_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-name-submit').click();
  await issued;
}

// askOnPage -- asks one question in the page's ask box and waits for the answer.
async function askOnPage(page: Page, text: string): Promise<void> {
  const box = page.locator('[data-sm="ask"]');
  await box.waitFor({ state: 'visible', timeout: 20_000 });
  await box.fill(text);
  await box.press('Enter');
}

const sm = (page: Page, name: string) => page.locator(`[data-sm="${name}"]`);

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('a bound code opens its page, and the page is that code', () => {
  let admin: Admin;

  test.beforeEach(async ({ playwright }) => { admin = await freshOwner(playwright); });
  test.afterEach(async () => { await admin.request.dispose(); });

  test('a code bound to a page lands the visitor on the page, not the default chat',
    async ({ page }) => {
      await publishPage(admin.request, admin.csrf, 'landing');
      const code = await createCode(admin.request, admin.csrf,
        { code: 'LAND-001', label: 'LANDS' });
      await bindCodeToPage(admin.request, admin.csrf, code.id, 'landing');

      await enterWithCode(page, 'LAND-001', 'Reader');

      // **What you scan into must be that exact page.** Stopping on the default chat
      // makes the rendering the owner built equivalent to never having built it -- and
      // the screen would still look perfectly normal.
      await expect(sm(page, 'marker')).toBeVisible({ timeout: 20_000 });
      expect(new URL(page.url()).pathname, 'the visitor is on the page this code opens')
        .toBe('/p/landing');
    });

  test('an unbound code still lands on the default chat', async ({ page }) => {
    await publishPage(admin.request, admin.csrf, 'unused');
    await createCode(admin.request, admin.csrf, { code: 'PLAIN-01', label: 'PLAIN' });

    await enterWithCode(page, 'PLAIN-01', 'Reader');

    // An unbound code is completely unchanged -- a new mechanism must not incidentally
    // alter the path that's already in production use today.
    expect(new URL(page.url()).pathname, 'a code with no page is unchanged from today')
      .toBe('/');
  });

  test('the page answers on the code’s session, and the turn shows up under that code',
    async ({ page }) => {
      await publishPage(admin.request, admin.csrf, 'ledger');
      const code = await createCode(admin.request, admin.csrf,
        { code: 'LEDG-001', label: 'LEDGER' });
      await bindCodeToPage(admin.request, admin.csrf, code.id, 'ledger');

      await enterWithCode(page, 'LEDG-001', 'Ledger Reader');
      await expect(sm(page, 'grant'), 'the page knows this reader arrived on a code')
        .toHaveText('on a code', { timeout: 20_000 });

      const tag = await scriptMockReplyText(admin.request, 'answered from the corpus');
      await askOnPage(page, `what is here ${tag}`);
      await expect(sm(page, 'answer')).toContainText('answered from the corpus',
        { timeout: 30_000 });

      // On the owner side: this turn must be recorded under **this exact code**. If it
      // can't be, the owner is left guessing which interface a given transcript came from.
      const convos = await admin.request.get(
        `${process.env['BACKEND_URL'] ?? 'http://localhost:8000'}/api/admin/conversations`,
        { headers: { 'X-Csrftoken': admin.csrf } },
      );
      expect(convos.status()).toBe(200);
      expect(JSON.stringify(await convos.json()),
        'the page’s turn is on the code’s ledger, not on a session of its own')
        .toContain('Ledger Reader');
    });
});

test.describe('a page cannot show what the viewer cannot read', () => {
  let admin: Admin;

  test.beforeEach(async ({ playwright }) => { admin = await freshOwner(playwright); });
  test.afterEach(async () => { await admin.request.dispose(); });

  test('a published entry opens on the page, a private one does not', async ({ page }) => {
    await publishPage(admin.request, admin.csrf, 'scoped');
    const token = await createAPIToken(admin.request, admin.csrf, 'page-scope');
    const sid = await initMCP(admin.request, token);

    const open = await seedWiki(admin.request, token, sid,
      { title: 'Open Note', body: 'anyone may read this', path: 'open-note' });
    await publishEntry(admin.request, token, sid, { genre: 'wiki', id: open.wikiID });
    await seedWiki(admin.request, token, sid,
      { title: 'Private Note', body: 'nobody may read this', path: 'private-note' });

    // The positive control runs first. Without it, the "won't open" case below could
    // just mean this page's read path was never built at all
    // ([[assertion-that-cannot-fail]]).
    await goto(page, '/p/scoped?read=open-note');
    await expect(sm(page, 'note-state')).toHaveText('open', { timeout: 20_000 });
    await expect(sm(page, 'note')).toHaveText('Open Note');

    // The criterion is **on the page**: the backend refusing while the page still
    // prints the title anyway (a stale cache/over-fetch) is exactly the failure mode
    // this check exists to catch.
    await goto(page, '/p/scoped?read=private-note');
    await expect(sm(page, 'note-state'),
      'an unpublished entry does not open for an anonymous reader')
      .toHaveText('denied', { timeout: 20_000 });
    await expect(sm(page, 'note')).toHaveText('');
  });
});

// Whether a hosted page can carry **the instance's own** media.
//
// A remote URL can, of course, be embedded (there's no CSP on that path), but that's
// not a reason to bypass the instance's own storage: `assets.upload` takes an address,
// fetches it server-side itself, and the bytes land in the instance's own object
// storage, from then on independent of the third party.
// The cost is two constraints, and both are only visible on the page itself:
//   - the address is **signed and expires in an hour** -- hardcode it into the build
//     output and the page is a field of broken images an hour after it ships;
//   - media is attached to a **corpus entry**, so the page has to fetch it by "load
//     this note, then read its assets".
test.describe('a page can serve the instance’s own media, not just remote URLs', () => {
  let admin: Admin;

  test.beforeEach(async ({ playwright }) => { admin = await freshOwner(playwright); });
  test.afterEach(async () => { await admin.request.dispose(); });

  test('an asset uploaded to a note shows up on the page, fetched at view time',
    async ({ page }) => {
      await publishPage(admin.request, admin.csrf, 'hosted');
      const token = await createAPIToken(admin.request, admin.csrf, 'page-assets');
      const sid = await initMCP(admin.request, token);

      const note = await seedWiki(admin.request, token, sid,
        { title: 'Shot Note', body: 'has a picture', path: 'shot-note' });
      await publishEntry(admin.request, token, sid, { genre: 'wiki', id: note.wikiID });
      const up = await uploadAsset({ request: admin.request, token, sid },
        'wiki', note.wikiID, MEDIA.pixel, { filename: 'on-the-page.png' });
      expect(up.content_type).toBe('image/png');

      await goto(page, '/p/hosted?shot=shot-note');
      await expect(sm(page, 'hosted-state')).toHaveText('ready', { timeout: 20_000 });
      await expect(sm(page, 'hosted-name')).toHaveText('on-the-page.png');

      // **The assertion is that it actually rendered**, not "there's an <img>". A
      // signed URL that's expired / a holder that failed to resolve / storage not
      // connected -- all three leave behind a zero-size <img>, and neither a
      // screenshot nor a DOM assertion can tell ([[text-assertion-cannot-see-layout]]).
      // **Wait for it to render, don't just glance at it once.** `hosted-state` flipping
      // to ready describes the page's own state, which happens before the browser
      // finishes fetching and decoding the image -- a one-shot evaluate can therefore
      // sample before decoding completes when the machine is busy, and report "not
      // rendered". Not one character of the criterion changed (still complete &&
      // naturalWidth > 0); what changed is that it now waits instead of sampling once.
      // This is exactly how full-suite run 630 went red, while a solo 5/5 run was
      // entirely green.
      await expect.poll(
        () => sm(page, 'hosted').evaluate(
          (el) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0),
        { timeout: 20_000, message: 'the instance-hosted image actually decoded' },
      ).toBe(true);
    });
});

test.describe('everything the code carries, carries onto the page', () => {
  let admin: Admin;

  test.beforeEach(async ({ playwright }) => { admin = await freshOwner(playwright); });
  test.afterEach(async () => { await admin.request.dispose(); });

  test('the turn allowance is the code’s allowance', async ({ page }) => {
    await publishPage(admin.request, admin.csrf, 'metered');
    const code = await createCode(admin.request, admin.csrf,
      { code: 'METR-001', label: 'METERED', max_turns_per_session: 1 });
    await bindCodeToPage(admin.request, admin.csrf, code.id, 'metered');

    await enterWithCode(page, 'METR-001', 'Metered Reader');
    const first = await scriptMockReplyText(admin.request, 'the one turn you get');
    await askOnPage(page, `first ${first}`);
    await expect(sm(page, 'answer')).toContainText('the one turn you get', { timeout: 30_000 });

    // The second turn must be blocked by the same quota. **The assertion is that the
    // page says something**, not "no answer arrived" -- a silently-failing page looks
    // exactly like a page that's still thinking.
    const second = await scriptMockReplyText(admin.request, 'this must never render');
    await askOnPage(page, `second ${second}`);
    // The assertion is that **the message the backend wrote for this refusal reached
    // the screen**, not "something is displayed". The previous version of the page
    // printed `send message: 403`: the SDK kept the status code and threw the message
    // away, so every page built with the SDK greeted readers with a bare number (F-P-5).
    await expect(sm(page, 'error'), 'the page says the allowance ran out, in words')
      .toContainText('turn limit', { timeout: 30_000 });
    await expect(sm(page, 'error'), 'and not a bare status code')
      .not.toContainText('403');
    await expect(sm(page, 'answer'), 'and no second answer arrives')
      .not.toContainText('this must never render');
  });

  test('the name allowance is the code’s allowance', async ({ browser, page }) => {
    await publishPage(admin.request, admin.csrf, 'named');
    const code = await createCode(admin.request, admin.csrf,
      { code: 'NAME-001', label: 'NAMES', max_members: 1 });
    await bindCodeToPage(admin.request, admin.csrf, code.id, 'named');

    await enterWithCode(page, 'NAME-001', 'First Reader');
    await expect(sm(page, 'marker')).toBeVisible({ timeout: 20_000 });

    // The second person arrives from a clean browser context -- the quota is a
    // property of this code, not of this machine.
    const other = await browser.newContext();
    const second = await other.newPage();
    await goto(second, '/?code=NAME-001');
    await second.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 20_000 });
    await second.getByTestId('visitor-name-input').fill('Second Reader');
    await second.getByTestId('visitor-name-submit').click();

    // Once a quota is full, it must be blocked at **the exact moment of entry**, and be
    // able to say why -- even when bound to a page, the wording must not change. The
    // assertion is on that message, not "the input box is still there": the product
    // replacing the input box with the reason for the refusal is the correct behavior.
    await expect(second.getByText(/reached its limit of names/i),
      'a code with one name left tells the second reader why')
      .toBeVisible({ timeout: 20_000 });
    expect(new URL(second.url()).pathname, 'and the second reader never reaches the page')
      .not.toBe('/p/named');
    await other.close();
  });

  test('revoking the code stops the page’s agent', async ({ page }) => {
    await publishPage(admin.request, admin.csrf, 'revoked');
    const code = await createCode(admin.request, admin.csrf,
      { code: 'REVK-001', label: 'REVOKED' });
    await bindCodeToPage(admin.request, admin.csrf, code.id, 'revoked');

    await enterWithCode(page, 'REVK-001', 'Revoked Reader');
    const ok = await scriptMockReplyText(admin.request, 'still allowed');
    await askOnPage(page, `before ${ok}`);
    await expect(sm(page, 'answer')).toContainText('still allowed', { timeout: 30_000 });

    // The owner revokes the grant -- the page's side must stop immediately. **There is
    // no cached access.**
    await revokeCode(admin.request, admin.csrf, code.id);

    const after = await scriptMockReplyText(admin.request, 'must not answer after revoke');
    await askOnPage(page, `after ${after}`);
    await expect(sm(page, 'error'), 'a revoked code stops the page’s agent')
      .not.toHaveText('', { timeout: 30_000 });
    await expect(sm(page, 'answer'))
      .not.toContainText('must not answer after revoke');
  });
});

test.describe('an arriving grant wins over the page’s own setting (I-4)', () => {
  let admin: Admin;

  test.beforeEach(async ({ playwright }) => { admin = await freshOwner(playwright); });
  test.afterEach(async () => { await admin.request.dispose(); });

  test('a page that allows BYOK still offers it when nobody presents a code',
    async ({ page }) => {
      await publishPage(admin.request, admin.csrf, 'byok-on');
      await setPageByoai(admin.request, admin.csrf, 'byok-on', true);

      await goto(page, '/p/byok-on');
      // The positive control. Without it, the next test's "wasn't offered" could just
      // mean this path was never built ([[assertion-that-cannot-fail]]).
      await expect(sm(page, 'byok'), 'with no grant, the page’s own setting applies')
        .toBeVisible({ timeout: 20_000 });
    });

  test('the same page does not offer BYOK to a reader who arrived on a code',
    async ({ page }) => {
      await publishPage(admin.request, admin.csrf, 'byok-void');
      await setPageByoai(admin.request, admin.csrf, 'byok-void', true);
      const code = await createCode(admin.request, admin.csrf,
        { code: 'BYOK-001', label: 'BYOK' });
      await bindCodeToPage(admin.request, admin.csrf, code.id, 'byok-void');

      await enterWithCode(page, 'BYOK-001', 'Granted Reader');
      await expect(sm(page, 'marker')).toBeVisible({ timeout: 20_000 });

      // The grant this reader is holding came from the owner, and it outranks
      // bring-your-own-key. Asking "want to use your own key?" again would hand the
      // owner's decision back to the reader.
      await expect(sm(page, 'byok'),
        'a reader who arrived on a code is not asked to bring a key')
        .toHaveCount(0);
    });

  test('turning BYOK off takes the offer away on the next load, with no snapshot',
    async ({ page }) => {
      await publishPage(admin.request, admin.csrf, 'byok-off');
      await setPageByoai(admin.request, admin.csrf, 'byok-off', true);
      await goto(page, '/p/byok-off');
      await expect(sm(page, 'byok')).toBeVisible({ timeout: 20_000 });

      await setPageByoai(admin.request, admin.csrf, 'byok-off', false);
      await goto(page, '/p/byok-off');
      await expect(sm(page, 'marker')).toBeVisible({ timeout: 20_000 });
      await expect(sm(page, 'byok'), 'the withdrawn setting takes effect on the next request')
        .toHaveCount(0);
    });
});
