// connector-card.ts —— /admin/connectors 上一张卡的通用驱动：定位、填 oauth2 凭据、
// 勾 scope、断连接状态，以及读 mock OAuth provider 的记录。
//
// 这些 helper 本来长在 `connector-connect-flow.spec.ts` 里。第二条 spec 要用同一套动作时，
// 抄一份是最省事的做法，也正是让两份判据慢慢走岔的做法 —— 所以搬进 fixtures/，
// 两条 spec 共用一份（顺带让那个文件回到行数闸门以内）。

import { expect, type Locator, type Page } from '@playwright/test';

const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';

/** openConnectorCard —— 从侧栏点进 connectors 区，定位某个连接器的卡（不用 page.goto）。 */
export async function openConnectorCard(page: Page, id: string): Promise<Locator> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.waitForURL('**/admin/connectors**');
  const card = page.getByTestId(`connector-row-${id}`);
  await expect(card).toBeVisible();
  return card;
}

/**
 * ensureDisconnected —— 若卡片当前是 connected，点 UI 的 disconnect 让它回到未连接。
 * 幂等：未连接时按钮不在，直接返回。
 */
export async function ensureDisconnected(card: Locator): Promise<void> {
  const btn = card.getByTestId('connector-disconnect-button');
  await (await btn.count() > 0 ? btn.click() : Promise.resolve());
}

/** fillOAuth2Creds —— 派生表单：oauth2 → client_id + client_secret；token 不填（dance 自动拿）。 */
export async function fillOAuth2Creds(
  card: Locator, clientId: string, clientSecret: string,
): Promise<void> {
  await card.getByTestId('connector-field-client_id').fill(clientId);
  await card.getByTestId('connector-field-client_secret').fill(clientSecret);
}

/** selectScope —— 勾/取消勾选连接器派生表单里的一个 scope。 */
export async function selectScope(
  card: Locator, scope: string, checked: boolean,
): Promise<void> {
  const box = card.getByTestId(`connector-scope-${scope}`);
  if (checked) await box.check();
  else await box.uncheck();
}

/**
 * expectConnected —— 锚定成**整串** 'connected'。原来写的是 /connected|已连接/i，而
 * toHaveText 的正则不加锚点就是子串匹配 —— "not connected" 同样命中。那是一条不会红的
 * 断言：未连接的卡片照样让它通过。
 */
export async function expectConnected(card: Locator): Promise<void> {
  await expect(card.getByTestId('connector-status')).toHaveText(/^(connected|已连接)$/i);
}

/** resetMockOAuthRecord —— 清掉 mock OAuth provider 记的 authorize/token 记录。 */
export async function resetMockOAuthRecord(page: Page): Promise<void> {
  const res = await page.request.get(`${MOCK}/__mock/oauth/reset`);
  if (res.status() !== 200) throw new Error(`reset mock oauth record: ${res.status()}`);
}
