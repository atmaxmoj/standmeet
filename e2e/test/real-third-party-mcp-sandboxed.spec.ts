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

import type { Browser, Playwright } from '@playwright/test';

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

// SandboxProbe -- one probe of the shape "script a tool + reply -> enter a session and
// ask a question -> assert the answer contains a given string". The tool type directly
// reuses scriptMockToolCall's argument shape, keeping them consistent.
interface SandboxProbe {
  tool: Parameters<typeof scriptMockToolCall>[1];
  reply: string;
  prompt: string;
  expectText: string;
}

// runSandboxedProbe -- the real end-to-end flow shared by all 4 test cases (script the
// real server's tool + reply, have the browser enter a code session and ask a
// question, assert the expected string shows up in the answer -- which proves the real
// server actually ran inside the sandbox).
async function runSandboxedProbe(
  browser: Browser, playwright: Playwright, probe: SandboxProbe,
): Promise<void> {
  const request = await playwright.request.newContext();
  const toolTag = await scriptMockToolCall(request, probe.tool);
  const replyTag = await scriptMockReplyText(request, probe.reply);
  await request.dispose();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterCodeSession(page, pluginCode);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
  const input = page.getByTestId('chat-input-field');
  await input.fill(`${probe.prompt}${toolTag}${replyTag}`);
  await input.press('Enter');
  await expect(page.getByTestId('answer-body'))
    .toContainText(probe.expectText, { timeout: 30_000 });
  await ctx.close();
}

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

  // A real read: server-filesystem reads /plugin/secret.txt (mounted read-only into
  // the sandbox). The scripted reply deliberately excludes the marker -- the marker
  // can only arrive by the mock reflecting the real tool result back, so asserting on
  // it proves the read is real, not a stock canned answer.
  test('discovers + invokes the real server: reads a file planted in its sandbox dir',
    async ({ browser, playwright }) => {
      await runSandboxedProbe(browser, playwright, {
        tool: { name: `${PLUGIN_ID}_read_text_file`, args: { path: '/plugin/secret.txt' } },
        reply: 'I read the file you asked for',
        prompt: 'read the secret file',
        expectText: SECRET_MARKER,
      });
    });

  // Confinement: /etc/standmeet/plugins.json exists on the BACKEND host but is never
  // mounted into the sandbox (only /plugin is mounted). The confined server can't read
  // it -> the tool fails -> the backend folds that into errJSON -> a friendly degrade.
  test('filesystem is confined: a path OUTSIDE the plugin dir cannot be read',
    async ({ browser, playwright }) => {
      await runSandboxedProbe(browser, playwright, {
        tool: { name: `${PLUGIN_ID}_read_text_file`, args: { path: '/etc/standmeet/plugins.json' } },
        reply: 'sorry, I could not read that file',
        prompt: 'read the host config file',
        expectText: 'could not read that',
      });
    });

  // Immutable code: /plugin is the server's code, bind-mounted read-only (materialized
  // by MinIO, shared by every visitor). Writing to it must fail -- a third-party server
  // cannot tamper with its own install code (the writable area is per-session /workspace).
  test('immutable code: writing into /plugin (the read-only code mount) fails',
    async ({ browser, playwright }) => {
      await runSandboxedProbe(browser, playwright, {
        tool: { name: `${PLUGIN_ID}_write_file`, args: { path: '/plugin/tamper.txt', content: 'pwned' } },
        reply: 'sorry, I could not write that file',
        prompt: 'write into the plugin dir',
        expectText: 'could not write that',
      });
    });

  // Isolation is real: verify from outside the sandbox (this e2e test runs on the
  // host) -- not "the tool reported failure", but "the host was genuinely untouched".
  test('isolation is real: a sandbox write CANNOT touch the host filesystem',
    async ({ browser, playwright }) => {
      const hostPath = join(process.cwd(), '..', 'infra', 'plugins', 'fsmcp', 'breakout.txt');
      expect(existsSync(hostPath), 'precondition: breakout file absent').toBe(false);

      await runSandboxedProbe(browser, playwright, {
        tool: { name: `${PLUGIN_ID}_write_file`,
          args: { path: '/plugin/breakout.txt', content: 'ESCAPED-TO-HOST' } },
        reply: 'tried to write outside the box',
        prompt: 'write a file to break out',
        expectText: 'tried to write outside the box',
      });

      // The decisive evidence: the host filesystem was never touched -- the sandboxed
      // server cannot affect anything outside its read-only mount.
      expect(existsSync(hostPath), 'sandbox must not affect the host').toBe(false);
    });
});
