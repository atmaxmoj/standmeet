// skill-progressive-disclosure.spec.ts —— Phase C / L2 (progressive disclosure, second
// level): once the agent decides a skill is relevant, it calls `skill_use({name})` to
// read back the **body**. The body renders as a standard SKILL.md
// (frontmatter name+description + body) — which verifies both L2 disclosure and
// SKILL.md serialization at once.
//
// Business story:
//   The role grants patent-review (body contains [SKILL-L2-BODY]) but not
// secret-skill (body contains [SECRET-BODY]). A visitor enters chat, and the AI calls
// skill_use:
//     - skill_use(patent-review) → the response is a SKILL.md (containing
//       name: patent-review + [SKILL-L2-BODY]) → echoed into the answer via the mock's
//       [skill_result:...] mechanism.
//     - skill_use(secret-skill) → the role isn't granted it → returns an error, and
//       **never discloses** [SECRET-BODY].
//
// The mock is driven explicitly via scriptMockToolCall (skill_use needs a name
// argument, which the natural path can't feed → scripting is required). Echo
// mechanism: a tool_result with the skill_ prefix gets echoed by the mock as
// [skill_result:<body>], so answer-body can assert on the disclosed content.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'pd-owner@example.com', password: 'correct-horse-battery-staple',
  handle: 'pdowner', fullName: 'PD Owner',
};

const CODE = 'PD-001';
const GRANTED_SKILL = 'patent-review';
const UNGRANTED_SKILL = 'secret-skill';
const L2_BODY_MARKER = '[SKILL-L2-BODY]';
const SECRET_BODY_MARKER = '[SECRET-BODY]';

interface SkillCreateResp { id: string; name: string }

test.describe('Phase C · L2 progressive disclosure: skill_use discloses SKILL.md body', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedSkillsRoleCode(request);
    await request.dispose();
  });

  test('L2: skill_use(granted) → answer carries the SKILL.md body (name + L2 marker)',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      const toolTag = await scriptMockToolCall(request, { name: 'skill_use', args: { name: GRANTED_SKILL } });
      const replyTag = await scriptMockReplyText(request, 'here is what the skill says');
      await request.dispose();

      const page = await openChat(browser);
      await ask(page, `use the patent-review skill${toolTag}${replyTag}`);
      const answer = page.getByTestId('answer-body');
      // SKILL.md serialization: frontmatter name + the body marker both disclosed.
      await expect(answer).toContainText(L2_BODY_MARKER, { timeout: 20_000 });
      await expect(answer).toContainText(`name: ${GRANTED_SKILL}`);
      await page.context().close();
    });

  test('L2 ACL: skill_use(ungranted) → error, the ungranted body is never disclosed',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      const toolTag = await scriptMockToolCall(request, { name: 'skill_use', args: { name: UNGRANTED_SKILL } });
      const replyTag = await scriptMockReplyText(request, 'I could not open that skill');
      await request.dispose();

      const page = await openChat(browser);
      await ask(page, `use the secret skill${toolTag}${replyTag}`);
      const answer = page.getByTestId('answer-body');
      await expect(answer).toContainText('could not open that', { timeout: 20_000 });
      // hard ACL: the ungranted skill's body must never reach the transcript.
      await expect(answer).not.toContainText(SECRET_BODY_MARKER);
      await page.context().close();
    });
});

async function openChat(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterCodeSession(page, CODE);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
  return page;
}

async function ask(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

async function seedSkillsRoleCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'pd-token');
  const sid = await initMCP(request, token);
  const granted = await callTool<SkillCreateResp>(request, token, sid, 'skill_create', {
    name: GRANTED_SKILL,
    description: 'Reviews patents [SKILL-L1-DESC].',
    prompt: `When reviewing, always note ${L2_BODY_MARKER}.`,
  });
  // ungranted skill exists in the owner's library but is NOT attached to the role.
  await callTool<SkillCreateResp>(request, token, sid, 'skill_create', {
    name: UNGRANTED_SKILL,
    description: 'Secret skill not granted to this role.',
    prompt: `Secret instructions ${SECRET_BODY_MARKER}.`,
  });
  await createRoleAndCode(request, csrf, granted.id);
}

async function createRoleAndCode(
  request: APIRequestContext, csrf: string, skillID: string,
): Promise<void> {
  const roleRes = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: 'pd-role', description: 'progressive disclosure fixture role',
      prompt_id: null, corpus_uris: ['wiki://**'],
      skill_ids: [skillID], mcp_server_ids: [],
    },
  });
  if (roleRes.status() !== 201) {
    throw new Error(`create role: ${roleRes.status()} ${await roleRes.text()}`);
  }
  const role = await roleRes.json() as { id: string };
  const codeRes = await request.post(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf },
    data: { code: CODE, label: 'PD code', ghosts: [], assumed_role_id: role.id },
  });
  if (codeRes.status() !== 201) {
    throw new Error(`create code: ${codeRes.status()} ${await codeRes.text()}`);
  }
}
