// real-third-party-mcp-network.spec.ts —— T4: the network sandbox is REAL, both
// ways, with a REAL download — and still nothing leaves the box.
//
// The yt-dlp class of plugin (anything that pulls external bytes) is the reason
// the sandbox has a network dimension at all. We prove it for real, not by
// asserting a flag: a genuine third-party fetch server actually downloads a file
// over HTTP — but from a LOCAL target inside the compose network (the
// `payload-origin` service), so the download is real while no traffic ever
// touches the public internet ("真的" and "纯本地" at once).
//
// Two declarations of the SAME real server, differing only in sandbox network
// policy, prove both directions:
//   - `netfetch`  (AllowNet=true)  → reaches the local origin, returns the bytes.
//   - `cagedfetch` (--network=none) → the identical fetch FAILS; egress denied.
//
// If the cage leaked, cagedfetch would succeed and the second assertion could
// never see the failure. If AllowNet did nothing, netfetch could never fetch.
//
// RED until: a real fetch MCP server is installed in the plugin sandbox dir, the
// `payload-origin` local HTTP service serves PAYLOAD_MARKER, both plugin ids are
// declared in infra/dev-plugins.json (one net-allowed, one caged), and the
// sandboxed-stdio loader honors AllowNet. Test first.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'netmcp@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'netmcp',
  fullName: 'Net MCP Owner',
};

// The local in-network origin the fetch server pulls from. Served by the
// `payload-origin` compose service; reachable only inside the compose network.
const LOCAL_URL = 'http://payload-origin:7070/payload.txt';
// Planted in payload.txt; reading it back through chat = a real download landed.
const PAYLOAD_MARKER = 'REAL-LOCAL-DOWNLOAD-c41d8e';

// Two ids = same real fetch server, opposite network policy (dev-plugins.json).
const PLUGIN_NET = 'netfetch';    // AllowNet=true
const PLUGIN_CAGED = 'cagedfetch'; // --network=none

let code = '';

test.describe('REAL third-party fetch MCP — network sandbox proven both ways', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // role grants BOTH ids so one visitor can exercise net-allowed + caged.
    const issued = await issueCodeWithSkills(request, csrf, {
      label: 'net', granted_skills: [PLUGIN_NET, PLUGIN_CAGED],
    });
    code = issued.code;
    await request.dispose();
  });

  test('AllowNet: the real server actually downloads the local payload',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, {
        name: `${PLUGIN_NET}_fetch`, args: { url: LOCAL_URL },
      });
      await scriptMockReplyText(request, 'fetched it');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, code);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill('download the payload');
      await input.press('Enter');
      // marker present = real egress to the local origin + real bytes returned.
      await expect(page.getByTestId('chatroom'))
        .toContainText(PAYLOAD_MARKER, { timeout: 30_000 });
      await ctx.close();
    });

  test('default --network=none: the identical fetch is blocked — egress denied',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, {
        name: `${PLUGIN_CAGED}_fetch`, args: { url: LOCAL_URL },
      });
      await scriptMockReplyText(request, 'sorry, I could not reach that');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, code);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill('download the payload (caged)');
      await input.press('Enter');
      // NO marker — the caged server cannot reach even the local origin. The AI
      // degrades gracefully on the folded error.
      await expect(page.getByTestId('answer-body'))
        .toContainText('could not reach that', { timeout: 30_000 });
      await expect(page.getByTestId('chatroom'))
        .not.toContainText(PAYLOAD_MARKER);
      await ctx.close();
    });
});
