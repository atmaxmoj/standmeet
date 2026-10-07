// role-fact-notes-reach-the-model.spec.ts —— a role's named fact notes are in the prompt the
// model gets, so a visitor's question about them needs no search (agent speedup W3).
//
// sijie.xyz, 2026-10-07: the hiring role names subjectivity://background, which states the
// owner's work permit. Asked "can he legally work for a US company?", the agent searched nothing
// and answered "my notes don't cover work authorization". The note was in scope, never in front
// of the model. A note the role names exactly now goes into every turn's instruction; a note it
// does not name stays behind the corpus tools.
//
// The mock gateway echoes the system prompt it received into the reply (`[system:...]`), so the
// assertion reads the rendered answer.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'facts@example.com', password: 'fact-notes-pass-1',
  handle: 'factsowner', fullName: 'Facts Owner',
};
const CODE = 'FACTS-01';
const PERMIT = 'HOLDS-A-CANADIAN-WORK-PERMIT-7Q';
const UNNAMED = 'DIARY-LINE-NOT-NAMED-BY-THE-ROLE-3Z';

test.describe('W3 · a role\'s named fact notes reach the model', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'facts-seed');
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'subjectivity_write',
      { title: 'background', body: `Where I can work: ${PERMIT}.` });
    await callTool(request, token, sid, 'subjectivity_write',
      { title: 'diary', body: `A private line: ${UNNAMED}.` });
    await seedRoleAndCode(request, csrf);
    await request.dispose();
  });

  test('the named note is in the prompt; a note the role does not name is not',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      const tag = await scriptMockReplyText(request, 'noted.');
      await enterCodeSession(page, CODE, 'Recruiter');
      await page.getByTestId('chat-input-field').fill(`can he work for a US company? ${tag}`);
      await page.getByTestId('chat-input-field').press('Enter');

      await expect(page.getByText(PERMIT, { exact: false }),
        'the role names subjectivity://background: its text reached the model')
        .toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(UNNAMED, { exact: false }),
        'a note outside the role\'s named list stays behind the tools').toHaveCount(0);
      await request.dispose();
    });
});

async function seedRoleAndCode(request: APIRequestContext, csrf: string): Promise<void> {
  const role = await createRole(request, csrf, {
    name: 'recruiting', description: 'names its fact note', greeting: '',
    corpus_uris: ['wiki://**', 'subjectivity://background'],
    skill_ids: [], mcp_server_ids: [], dock_buttons: [], waypoints: [],
  });
  await createCode(request, csrf, { code: CODE, label: 'Facts', assumed_role_id: role.id });
}
