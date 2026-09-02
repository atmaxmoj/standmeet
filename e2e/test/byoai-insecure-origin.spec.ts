// byoai-insecure-origin.spec.ts — F-D-14. **BYOAI is dead on this instance unless it
// is opened on its own machine.**
//
// The visitor's key is sealed into the browser vault with `crypto.subtle`
// (`byoai-vault.ts:54`), and `crypto.subtle` **only exists in a secure context**.
// `localhost` / `127.0.0.1` is the only origin that counts as secure without TLS —
// so dev, e2e, and every round of manual audit **all run on the one path that can't
// see this defect**, while a real visitor and a real owner always open this instance
// from a different machine, over a domain or an IP.
//
// What it looks like driven out in prod: fill in provider/endpoint/model/key, click
// START PUBLIC CHAT → `POST /api/v1/sessions` returns 200 (backend is fine) → the
// screen says **"Couldn't check that just now. Try again."**. Retry ten thousand
// times, same result — that message is a lie.
//
// **The assertion cannot be written against localhost** (there `isSecureContext` is
// always true, so it can never go red). So this spec uses Chrome's
// `--host-resolver-rules` to point a domain back at the local machine: the origin
// becomes `http://visitor.test:…` — **a genuinely non-secure origin**, while the
// backend is still the same one. This is exactly what a real visitor gets.
//
// It asserts two things, both mechanism, not wording:
//   1. The button **can't be entered** (disabled) — a person must not fill everything
//      in only to hit a wall at the end;
//   2. The panel states **why**, and points at https — "try again" is a lie here.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoOnHost } from '@/fixtures/navigate';

const OWNER = {
  email: 'insecure@example.com',
  password: 'insecure-origin-pass-1',
  handle: 'insecureowner',
  fullName: 'Insecure Origin Owner',
};

// INSECURE_HOST — a domain that resolves back to the local machine but is **not**
// localhost. Chrome only treats localhost / 127.0.0.1 / ::1 as secure, so on this
// origin `crypto.subtle` is undefined — identical to what a real visitor gets opening
// the owner's domain over http.
const INSECURE_HOST = 'visitor.test';

test.use({
  launchOptions: { args: [`--host-resolver-rules=MAP ${INSECURE_HOST} 127.0.0.1`] },
});

test.describe('F-D-14 · BYOAI on a non-secure origin says the true thing', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance takes ~48s under high load
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('the panel refuses up front and points at https, instead of inviting a retry',
    async ({ page }) => {
      // Same backend, same page, only the origin changes: localhost → visitor.test.
      await gotoOnHost(page, INSECURE_HOST, '/gate');

      await page.getByTestId('byoai-provider').selectOption('deepseek');
      await page.getByTestId('byoai-endpoint').fill('https://api.deepseek.com');
      await page.getByTestId('byoai-model').fill('deepseek-chat');
      await page.getByTestId('byoai-key').fill('sk-0123456789abcdef0123456789abcdef');

      // (1) Filling everything in must not let it through — since this path doesn't
      // work, the button must not look like it does.
      await expect(page.getByTestId('byoai-submit'),
        'on a non-secure origin the key cannot be stored, so the button must not invite the click')
        .toBeDisabled();

      // (2) It states why, and points at the way out (https). Assert on the word
      // https, not the exact wording of the sentence.
      await expect(page.getByTestId('byoai-insecure-origin'),
        'the panel explains that this page has to be served over https')
        .toContainText(/https/i);
    });
});
