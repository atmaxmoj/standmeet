// c2-keypair-ui.spec.ts —— Phase C-2: /admin/api-mcp UI flow。
//
// 业务故事：
//   alice 在 /admin/api-mcp 输入 device label "mojat-mbp" → 点 Generate。
//   NewlyCreatedBanner 显示 key id + PEM + Download .pem 链接。安装说明
//   面板 (MCPClientPanel) 显示 STANDMEET_CREDS_PATH 模板而非老 plaintext
//   bearer。Revoke 按钮删 key，list 立刻空。

import { test, expect } from '@/fixtures/test';

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
test.describe('C-2 owner generates MCP keypair from admin UI', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('generate → banner shows keyId + PEM + download link → list updates → revoke',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'api-mcp');
      await page.waitForURL('**/admin/api-mcp', { timeout: 5_000 });

      // Generate
      await page.getByTestId('token-name').fill('mojat-mbp');
      await page.getByTestId('token-create').click();

      // NewlyCreatedBanner appears with keyId + PEM + download link
      const banner = page.getByTestId('new-token');
      await expect(banner).toBeVisible({ timeout: 5_000 });
      const keyID = await banner.getByTestId('key-id').innerText();
      expect(keyID.length).toBeGreaterThan(20); // uuid string
      const pem = await banner.getByTestId('key-pem').innerText();
      expect(pem).toContain('BEGIN PRIVATE KEY');
      expect(pem).toContain('END PRIVATE KEY');
      const downloadLink = banner.getByTestId('key-pem-download');
      const href = await downloadLink.getAttribute('href');
      expect(href).toMatch(/^data:application\/x-pem-file;base64,/);

      // List should now contain a row labelled "mojat-mbp"
      await expect(page.getByTestId('token-list')).toBeVisible();
      await expect(page.getByText('mojat-mbp')).toBeVisible();

      // Install snippet panel shows STANDMEET_CREDS_PATH (not plaintext bearer)
      const snippet = await page.getByTestId('mcp-snippet').innerText();
      expect(snippet).toContain('STANDMEET_CREDS_PATH');
      expect(snippet).not.toContain('STANDMEET_API_KEY');

      // Revoke
      await page.getByTestId('token-delete-mojat-mbp').click();
      await expect(page.getByText('mojat-mbp')).toBeHidden({ timeout: 5_000 });
    });

  test('install snippet panel cycles through client tabs',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'api-mcp');
      await page.waitForURL('**/admin/api-mcp', { timeout: 5_000 });
      // Default tab = claude-desktop; snippet should match.
      await expect(page.getByTestId('mcp-snippet')).toContainText('STANDMEET_CREDS_PATH');
      // Click "credentials.json" tab → shows {keyId, privateKeyPem} JSON template.
      await page.getByTestId('mcp-client-tab-creds-template').click();
      await expect(page.getByTestId('mcp-snippet')).toContainText('privateKeyPem');
      await expect(page.getByTestId('mcp-snippet')).toContainText('BEGIN PRIVATE KEY');
    });
});
