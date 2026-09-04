// ai-provider-config.spec.ts —— owner configures their own AI provider + key
// on /admin/api-mcp. The plaintext key is never read back; a toast confirms success.
//
// Phase 1 only checks "the key can be stored and cleared, and the UI state toggles
// correctly". Phase 2, driving a real visitor chat through the Anthropic path, lives
// in a later spec.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner configures AI provider + key from /admin/api-mcp', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('pick anthropic + paste key → key set; clear → mock + key gone',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'api-mcp');

      await page.getByTestId('ai-provider-anthropic').click();
      // switching provider fills the preset endpoint by default; the model must be typed by hand (no default).
      await page.getByTestId('ai-provider-model').fill('claude-haiku-4-5-20251001');
      await page.getByTestId('ai-provider-key').fill('sk-ant-fake-test-key');
      await page.getByTestId('ai-provider-save').click();
      await expect(page.getByTestId('toast-success').filter({ hasText: 'AI provider saved' }))
        .toBeVisible();
      // reload the panel to see the key_configured state arrive (placeholder switches).
      await page.reload();
      await expect(page.getByTestId('ai-provider-key'))
        .toHaveAttribute('placeholder', /already set/);
      // #33: model is backfilled from the SoT (/me), not the preset default/empty —— owner sees the value they stored.
      await expect(page.getByTestId('ai-provider-model'))
        .toHaveValue('claude-haiku-4-5-20251001');

      await page.getByTestId('ai-provider-clear').click();
      await expect(page.getByTestId('toast-success').filter({ hasText: 'AI provider cleared' }))
        .toBeVisible();
      await expect(page.getByTestId('ai-provider-clear')).toHaveCount(0);
    });

  // F-R-9 —— **an owner pointing at their own self-hosted endpoint must be able to pick a model.**
  //
  // the card itself states what it supports: *"point at your own self-hosted OpenAI-compatible endpoint
  // (ollama / vllm / lm-studio)"* —— and all three **run on private addresses** (ollama defaults to
  // `localhost:11434`). Today clicking `LOAD MODELS` returns
  // *"That endpoint resolves to an internal/private address and is not allowed."*
  //
  // **the check isn't wrong, it's in the wrong place**: `/api/v1/inference/models` is a **public route**
  // (the visitor BYOAI panel uses it too), and blocking private addresses there is entirely correct;
  // but the owner's admin card shares that same route with visitors.
  // The product already split the trust tiers correctly on the **chat** side —— `eino_model.go`'s
  // `validateUntrustedEndpoint` only checks `Untrusted` (BYOAI) endpoints, its comment reading "Owner
  // creds (trusted self-host config) are not checked". This side hadn't caught up ([[lesson-not-swept-to-neighbours]]).
  //
  // teach the stand-in the rule first: dev's llm-gateway now also answers `GET /v1/models`, reporting two
  // `mock-selfhost-*` —— two and not one, otherwise "the list came back" can't be told apart from "the product stuffed in a default".
  test('owner points at a self-hosted endpoint → the model list comes back (F-R-9)',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'api-mcp');
      await page.getByTestId('ai-provider-custom').click();
      // the self-hosted stand-in in the dev stack. It's a docker service name → private address, the same class as an owner's home ollama.
      // don't write `/v1`: the backend appends `/v1/models` itself, and writing it makes `/v1/v1/models` → upstream 404.
      // that kind of red looks like "can't list", but really the address was written one segment too long.
      await page.getByTestId('ai-provider-endpoint').fill('http://llm-gateway:9300');
      await page.getByTestId('ai-provider-key').fill('sk-selfhost-does-not-check-keys');
      await page.getByTestId('ai-provider-load-models').click();

      // judging the **good outcome**: the list really came back, and it's the two this endpoint reports.
      const picker = page.getByTestId('ai-provider-model-select');
      await expect(picker, 'LOAD MODELS 之后该出现一个下拉').toBeVisible({ timeout: 15_000 });
      await picker.selectOption('mock-selfhost-large');
      await expect(picker).toHaveValue('mock-selfhost-large');
    });

  // F-R-11 —— **once the key is already stored, LOAD MODELS can no longer be clicked.**
  //
  // the one above **typed the key by hand in the same session**, so it never hit the real steady state:
  // the owner configured it yesterday, opens this screen today, the key field reads `already set · type
  // to replace` (the value is never read back, which is correct), so the `key: keyText` that `onLoad`
  // sends is an **empty string** → the backend's `missingListModelsField` immediately 400s `key required`.
  // The owner faces "clicked, nothing happened", while that key is plainly stored and every visitor turn is using it.
  //
  // hit on prod (while driving resilience check 3): `POST /api/v1/inference/models → 400`, 4ms, not a single byte received upstream.
  //
  // the check must be able to fail: **store then reload**, then click. This test differs from the one above by exactly the word "reload".
  test('a stored key still lists models — the owner should not have to retype it (F-R-11)',
    ({ adminPage: page }) => storedKeyStillLists(page));

  // F-R-12 —— **"can't reach it" and "reached it, it refused" are not the same thing.**
  //
  // the cell resilience check 3 ⭐ named: a key that **can chat but cannot list models** (common on real
  // providers, where listing models needs a different permission). The product said, for this class,
  // *"Couldn't reach the model provider — check the base URL and key."* —— but the address is perfectly
  // fine, and the owner gets sent to check something that isn't broken. Same family as F-C-42: saying
  // "refused" as "couldn't dial".
  //
  // teach the stand-in the rule first: llm-gateway now returns 403 + a real-provider-style error body
  // for the `sk-chat-but-cannot-list` key on `/v1/models` ([[stand-in-is-politer-than-reality]]).
  test('a key that chats but cannot list models says so (F-R-12)',
    ({ adminPage: page }) => expectModelsSentence(page, {
      key: 'sk-chat-but-cannot-list',
      // says "it refused this key", not "can't reach it"; not one word of the upstream response body may leak.
      says: /refused to list models for this key/i,
      neverSays: /insufficient_permissions/,
    }));

  // the third "won't give" in the same family: **rate-limited**. The difference from the one above isn't
  // wording but the **next step** —— one has you change a permission, the other just wait a moment. Without
  // this sentence, the owner goes digging through the address and key, and neither of those is wrong.
  test('a rate-limited provider says to wait, not to check the key (F-R-12)',
    ({ adminPage: page }) => expectModelsSentence(page, {
      key: 'sk-rate-limited-right-now',
      says: /wait a moment/i,
      neverSays: /rate_limit_error/,
    }));
});

// storedKeyStillLists —— store once, reopen this screen, then click LOAD MODELS.
// The word "reload" is the entire difference between this and the one above, and it's exactly where the product originally broke (F-R-11).
async function storedKeyStillLists(page: Page): Promise<void> {
  await gotoAdminSection(page, 'api-mcp');
  await page.getByTestId('ai-provider-custom').click();
  await page.getByTestId('ai-provider-endpoint').fill('http://llm-gateway:9300');
  // model is a required field for saving (SAVE is greyed while it's empty) —— type one first; what this
  // checks is the LOAD MODELS **after saving**, not the save itself.
  await page.getByTestId('ai-provider-model').fill('mock-selfhost-large');
  await page.getByTestId('ai-provider-key').fill('sk-selfhost-does-not-check-keys');
  await page.getByTestId('ai-provider-save').click();

  await gotoAdminSection(page, 'dashboard');
  await gotoAdminSection(page, 'api-mcp');
  await expect(
    page.getByText('key set · leave blank to keep'),
    'precondition: the key really is stored and the field really is empty',
  ).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('ai-provider-load-models').click();

  await expect(
    page.getByTestId('ai-provider-model-select'),
    'a configured provider must list its models without the owner retyping the key',
  ).toBeVisible({ timeout: 15_000 });
}

// expectModelsSentence —— take a key the upstream will reject, click LOAD MODELS, read the sentence under the button.
async function expectModelsSentence(
  page: Page, want: { key: string; says: RegExp; neverSays: RegExp },
): Promise<void> {
  await gotoAdminSection(page, 'api-mcp');
  await page.getByTestId('ai-provider-custom').click();
  await page.getByTestId('ai-provider-endpoint').fill('http://llm-gateway:9300');
  await page.getByTestId('ai-provider-key').fill(want.key);
  await page.getByTestId('ai-provider-load-models').click();

  const said = page.getByTestId('ai-provider-models-error');
  await expect(said, 'it has to say something').toBeVisible({ timeout: 15_000 });
  await expect(said, 'the sentence has to name what actually happened').toContainText(want.says);
  await expect(said, 'no upstream body echoed at the owner').not.toContainText(want.neverSays);
}

