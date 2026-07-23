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

      // List should now contain a row labelled "mojat-mbp"。scope 到
      // token-list 避免跟 banner 内的 label 多匹中。
      const list = page.getByTestId('token-list');
      await expect(list).toBeVisible();
      await expect(list.getByText('mojat-mbp')).toBeVisible();

      // Install snippet panel shows STANDMEET_CREDS_PATH (not plaintext bearer)
      const snippet = await page.getByTestId('mcp-snippet').innerText();
      expect(snippet).toContain('STANDMEET_CREDS_PATH');
      expect(snippet).not.toContain('STANDMEET_API_KEY');

      // Revoke
      await page.getByTestId('token-delete-mojat-mbp').click();
      await expect(list.getByText('mojat-mbp')).toBeHidden({ timeout: 5_000 });
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

  // #105: 端点 handoff 展示真的 /mcp 端点,不再假装有可下载的 standmeet-mcp 二进制
  // (原先 4 个平台链接指向不存在的 repo、大小是编的)。
  test('mcp endpoint panel shows the real /mcp endpoint, no fake binary downloads',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'api-mcp');
      await page.waitForURL('**/admin/api-mcp', { timeout: 5_000 });
      const ep = page.getByTestId('mcp-endpoint');
      await expect(ep).toBeVisible();
      await expect(ep).toContainText('/mcp'); // real endpoint (origin/mcp)
      // The old fake download artifacts must be gone.
      await expect(page.getByText(/standmeet-mcp_1\.0\.0_(darwin|linux|windows)/)).toHaveCount(0);
    });

  // F-M-1: the page must not contradict itself about the stdio client. MCPClientPanel serves a
  // working `npx @standmeet/mcp-client` stdio config (Claude Desktop / Cursor); MCPDownloadPanel's
  // note used to say "a pre-packaged stdio client wrapper … isn't released yet" — false, and it
  // contradicted the config two blocks up (an owner would think Claude Desktop can't connect while
  // the config right there does exactly that). If it serves the stdio config, it must not claim the
  // stdio client is unreleased.
  test('does not claim the stdio client is unreleased while serving an npx stdio config (F-M-1)',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'api-mcp');
      await page.waitForURL('**/admin/api-mcp', { timeout: 5_000 });
      await expect(page.getByTestId('mcp-snippet'), 'precondition: serves the npx stdio client')
        .toContainText('@standmeet/mcp-client');
      await expect(
        page.getByText(/isn.?t released yet/i),
        'must not tell the owner the stdio client is unreleased while serving its config',
      ).toHaveCount(0);
    });
});
