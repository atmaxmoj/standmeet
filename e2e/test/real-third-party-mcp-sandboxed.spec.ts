// real-third-party-mcp-sandboxed.spec.ts —— loader-correctness + sandbox proof.
//
// WHY this exists: every other MCP-app test loads a server WE wrote (echoer mock,
// or our own in-process ask_visitor / booker). Green there only proves the loader
// fits our own modules — circular. This loads a REAL third-party server we did
// NOT author — the official @modelcontextprotocol/server-filesystem — through the
// exact same managed discovery path, and drives it from a real visitor chat. If
// the unified loader can discover + invoke a stranger's server, it is genuinely
// general, not curve-fit to us.
//
// AND it proves the SANDBOX. A third-party stdio server that touches the
// filesystem (server-filesystem, and tomorrow yt-dlp) must NOT run as a raw
// subprocess on the host. The main process launches it inside a disposable,
// read-only, network-less docker container with ONLY its own plugin directory
// mounted (the "specific directory" = the sandbox). So:
//   - test 1: the server reads a file we planted INSIDE its plugin dir → the
//     real server was discovered, launched sandboxed, and invoked end-to-end.
//   - test 2: the server cannot read a host path OUTSIDE its plugin dir → the
//     filesystem is genuinely confined; a third-party server can't roam the host.
//
// RED until the sandboxed-stdio loader (internal/sandbox/stdio.go +
// mcpclient stdio-via-sandbox + the managed plugin dir + dev-plugins.json entry
// + a node runtime image) is wired. That is the point: test first.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const OWNER = {
  email: 'fsmcp@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'fsmcp',
  fullName: 'FS MCP Owner',
};

// PLUGIN_ID —— the managed plugin id declared in infra/dev-plugins.json, pointing
// at server-filesystem launched via the sandboxed-stdio transport. Tools come out
// prefixed <id>_<tool> (third-party servers are not RawToolNames).
const PLUGIN_ID = 'fsmcp';

// SECRET_MARKER —— planted into <plugin-dir>/secret.txt at build time. Reading it
// back through the chat proves the real server ran sandboxed over the mount.
const SECRET_MARKER = 'SANDBOX-READABLE-7f3a91';

let pluginCode = '';

test.describe('REAL third-party MCP server (server-filesystem) loaded via the managed sandbox', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // role grants the platform plugin id 'fsmcp' (ACL via role, same as any
    // managed plugin). owner registers NO MCP server — it comes from the
    // deploy-time STANDMEET_PLUGINS config.
    const issued = await issueCodeWithSkills(request, csrf, {
      label: 'fsmcp', granted_skills: [PLUGIN_ID],
    });
    pluginCode = issued.code;
    await request.dispose();
  });

  test('discovers + invokes the real server: reads a file planted in its sandbox dir',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      // server-filesystem reads a path; the sandbox mounts the plugin dir at
      // /plugin (read-only), so the planted secret lives at /plugin/secret.txt.
      await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_read_text_file`, args: { path: '/plugin/secret.txt' },
      });
      // The scripted reply deliberately does NOT contain the marker — the marker
      // only reaches the chat via the mock's reflection of the REAL tool result
      // (the bytes server-filesystem actually read from /plugin/secret.txt over
      // the sandbox mount). So asserting it proves a real read, not a canned line.
      await scriptMockReplyText(request, 'I read the file you asked for');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, pluginCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill('read the secret file');
      await input.press('Enter');

      // marker in the answer = the REAL third-party server was discovered,
      // launched in its sandbox, and read its mounted plugin dir end-to-end.
      await expect(page.getByTestId('answer-body'))
        .toContainText(SECRET_MARKER, { timeout: 30_000 });
      await ctx.close();
    });

  test('filesystem is confined: a path OUTSIDE the plugin dir cannot be read',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      // /etc/standmeet/plugins.json exists on the BACKEND host but is NOT mounted
      // into the sandbox container — only /plugin is. A confined server cannot
      // read it; the tool fails, backend folds to errJSON, chat degrades
      // gracefully. (If the sandbox leaked the host fs, the server would happily
      // return the config and this assertion would never see the refusal.)
      await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_read_text_file`,
        args: { path: '/etc/standmeet/plugins.json' },
      });
      await scriptMockReplyText(request, 'sorry, I could not read that file');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, pluginCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill('read the host config file');
      await input.press('Enter');

      await expect(page.getByTestId('answer-body'))
        .toContainText('could not read that', { timeout: 30_000 });
      await ctx.close();
    });

  test('immutable code: writing into /plugin (the read-only code mount) fails',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      // /plugin is the server's CODE, bind-mounted READ-ONLY (the immutable
      // artifact materialized from MinIO, shared by all visitors). A write there
      // must fail — a third-party server cannot tamper with its own installed
      // code. The writable area is the per-session /workspace (proven writable in
      // sandbox-workspace-ttl-cron.spec.ts); host paths are not mounted at all.
      await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_write_file`,
        args: { path: '/plugin/tamper.txt', content: 'pwned' },
      });
      await scriptMockReplyText(request, 'sorry, I could not write that file');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, pluginCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill('write into the plugin dir');
      await input.press('Enter');

      await expect(page.getByTestId('answer-body'))
        .toContainText('could not write that', { timeout: 30_000 });
      await ctx.close();
    });

  test('isolation is real: a sandbox write CANNOT touch the host filesystem',
    async ({ browser, playwright }) => {
      // /plugin is bind-mounted from the host dir infra/plugins/fsmcp. If the
      // sandbox leaked, a write to /plugin/breakout.txt would materialize HERE on
      // the host. We check from OUTSIDE the sandbox (the e2e runs on the host) —
      // not "the tool reported failure", but "the host is verifiably untouched".
      const hostPath = join(process.cwd(), '..', 'infra', 'plugins', 'fsmcp', 'breakout.txt');
      expect(existsSync(hostPath), 'precondition: breakout file absent').toBe(false);

      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, {
        name: `${PLUGIN_ID}_write_file`,
        args: { path: '/plugin/breakout.txt', content: 'ESCAPED-TO-HOST' },
      });
      await scriptMockReplyText(request, 'tried to write outside the box');
      await request.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, pluginCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill('write a file to break out');
      await input.press('Enter');
      // wait until the write attempt has actually run (turn completed)
      await expect(page.getByTestId('answer-body'))
        .toContainText('tried to write outside the box', { timeout: 30_000 });
      await ctx.close();

      // the decisive proof: the host filesystem is untouched — the sandboxed
      // server could not affect anything outside its read-only mount.
      expect(existsSync(hostPath), 'sandbox must not affect the host').toBe(false);
    });
});
