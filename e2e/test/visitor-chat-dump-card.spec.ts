// visitor-chat-dump-card.spec.ts — GenericDumpCard: the fallback card for skill_* /
// ext_* tool results (a debug-grade JSON box). This is the only card with no ui:// —
// it **doesn't migrate** to Phase F, staying a permanent fallback (for third-party ext
// tools / skills that have no card of their own). It previously had zero test coverage;
// this fills that in:
//   a skill_use call → tool-card-skill_use renders + kicker=tool name + the <pre>'s
//   JSON contains the result body.
// The judgment criterion runs through cardKindFor(skill_*/ext_*) → 'dump' →
// GenericDumpCard (tool-call-shape.ts).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'dump-owner@example.com', password: 'correct-horse-battery-staple',
  handle: 'dumpowner', fullName: 'Dump Owner',
};
const CODE = 'DUMP-001';
const SKILL = 'patent-review';
const BODY_MARKER = '[DUMP-CARD-BODY]';

interface SkillCreateResp { id: string; name: string }

test.describe('visitor chat · GenericDumpCard (skill_*/ext_* fallback card)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedSkillRoleCode(request);
    await request.dispose();
  });

  test('skill_use result → tool-card-skill_use dump card with name + JSON body', async ({ browser, playwright }) => {
    const request = await playwright.request.newContext();
    const toolTag = await scriptMockToolCall(request, { name: 'skill_use', args: { name: SKILL } });
    const replyTag = await scriptMockReplyText(request, 'rendered in the dump card');
    await request.dispose();

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE);
    await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });

    const input = page.getByTestId('chat-input-field');
    await input.fill(`use the patent-review skill${toolTag}${replyTag}`);
    await input.press('Enter');

    // GenericDumpCard: testid tool-card-<name>, kicker = tool name, <pre> = JSON of result.
    const card = page.getByTestId('tool-card-skill_use');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('skill_use');       // kicker

    // **The payload doesn't spill onto the visitor's face by default** (F-D-10). This
    // card's own comment says it is a "debug-grade dump for the *owner* to observe what
    // ran on the visitor's side" — yet it renders inside the **visitor's** transcript.
    // What's actually captured in prod is a big block of monospace JSON, complete with
    // literal `\n`s and the leading quote mark.
    // This assertion used to **require that raw text be visible verbatim**
    // (`toContainText(BODY_MARKER)`) — yet another case of "the guard records the defect
    // itself" ([[parked-test-carries-a-wrong-diagnosis]]).
    // The criterion changed to: **collapsed by default** (still visible if the owner
    // expands it; the visitor never has to look past it first).
    // Assert against the copy **inside the card**: the mock LLM echoes the tool result
    // back into the answer body, so this marker appears twice on the page, and what
    // this test guards is the card ([[stand-in-is-politer-than-reality]] in reverse —
    // here the stand-in is noisier than the real world).
    await expect(
      card.getByText(BODY_MARKER),
      '技能正文默认不该摊开在访客的逐字稿里',
    ).toBeHidden();
    // What the owner needs isn't lost: expanding still shows it.
    await card.locator('summary').click();
    await expect(card.getByText(BODY_MARKER)).toBeVisible({ timeout: 5_000 });
    await ctx.close();
  });
});

async function seedSkillRoleCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'dump-token');
  const sid = await initMCP(request, token);
  const skill = await callTool<SkillCreateResp>(request, token, sid, 'skill_create', {
    name: SKILL,
    description: 'Reviews patents.',
    prompt: `When reviewing, always note ${BODY_MARKER}.`,
  });
  const roleRes = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: 'dump-role', description: 'dump card fixture role',
      prompt_id: null, corpus_uris: ['wiki://**'],
      skill_ids: [skill.id], mcp_server_ids: [],
    },
  });
  if (roleRes.status() !== 201) throw new Error(`create role: ${roleRes.status()}`);
  const role = await roleRes.json() as { id: string };
  const codeRes = await request.post(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf },
    data: { code: CODE, label: 'dump code', ghosts: [], assumed_role_id: role.id },
  });
  if (codeRes.status() !== 201) throw new Error(`create code: ${codeRes.status()}`);
}
