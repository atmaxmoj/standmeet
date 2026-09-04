import { expect, type Page } from '@playwright/test';

// expectErrorToast —— assert an error toast appears with the expected text. A failed mutation must be visible to the owner ——
// this assertion guards exactly the "failures are no longer silent" layer (the whole toast-error path had 0 test coverage before).
export async function expectErrorToast(page: Page, text: RegExp | string): Promise<void> {
  await expect(page.getByTestId('toast-error').filter({ hasText: text })).toBeVisible();
}

// expectSuccessToast —— assert a success toast (the counterpart, so tests don't each write their own selector).
export async function expectSuccessToast(page: Page, text: RegExp | string): Promise<void> {
  await expect(page.getByTestId('toast-success').filter({ hasText: text })).toBeVisible();
}
