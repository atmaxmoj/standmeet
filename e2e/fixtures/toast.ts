import { expect, type Page } from '@playwright/test';

// expectErrorToast —— 断言一个 error toast 冒出来且带期望文案。mutation 失败必须让 owner 看见——
// 这条断言守的正是「失败不再静默」那层（整套 toast-error 之前 0 测试覆盖）。
export async function expectErrorToast(page: Page, text: RegExp | string): Promise<void> {
  await expect(page.getByTestId('toast-error').filter({ hasText: text })).toBeVisible();
}

// expectSuccessToast —— 断言成功 toast（配套，避免测试各写各的 selector）。
export async function expectSuccessToast(page: Page, text: RegExp | string): Promise<void> {
  await expect(page.getByTestId('toast-success').filter({ hasText: text })).toBeVisible();
}
