// persona-reaches-the-model.spec.ts -- F-A-36. The **persona** the owner wrote for this
// audience, this code's own prompt, and each skill's name must actually show up in the
// system prompt sent to the model.
//
// The backend side of this has always been correct: the role's persona body + the code
// prompt (#104) + each skill's L1 line get assembled into one block by
// `ComposeDynamicPersona`, sent down with the /sessions response (`system_prompt_persona`).
// The browser stores it into `PageSession.persona` -- a typed, persisted, restorable field
// -- **and then nowhere in the entire repo ever reads it**. This turn's system prompt is
// assembled by `composeSystemPrompt()`, which only iterates `systemPromptPartIDs`
// (visitor-header + one section per capability, with no persona section); the backend
// doesn't fill the gap either -- `agent_loop.go`'s Instruction uses whatever `req.System`
// the browser sent, verbatim.
//
// Three things therefore never reach the model: (1) the persona the owner configured,
// (2) each code's own prompt, (3) skill names. The third means `skill_use` can never name
// a skill (its argument is the exact skill name), making the entire skill/sandbox-script
// path unreachable for visitors -- this is why the sandbox module could never be driven.
// The first is likely also the cause of UX-66.
//
// **The criterion sits on text the visitor can actually see**: the mock gateway echoes
// the system prompt it received verbatim as `[system:...]` (every existing spec that
// verifies prompt assembly relies on this), so the assertion just reads the rendered
// reply directly.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'persona@example.com',
  password: 'persona-reaches-pass-1',
  handle: 'personaowner',
  fullName: 'Persona Owner',
};

const CODE = 'PERSONA-01';
// A line that can only have come from the role persona -- not in the corpus, not in the
// header either.
const PERSONA_MARK = 'ALWAYS-OPEN-WITH-THE-LEDGER';
const ROLE = 'persona-carrier';

test.describe('F-A-36 · the persona the owner wrote reaches the model', () => {
  let roleID = '';

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance takes ~48s under high load, while the hook
                              // only gives 30s by default
    roleID = await initOwner(playwright);
    expect(roleID, 'the role carrying the persona exists').not.toBe('');
  });

  test('the role persona is in the system prompt the model actually receives',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      const tag = await scriptMockReplyText(request, 'noted.');
      await enterCodeSession(page, CODE, 'Reader');
      await page.getByTestId('chat-input-field').fill(`hello ${tag}`);
      await page.getByTestId('chat-input-field').press('Enter');

      // The mock echoes the system prompt it received verbatim into the reply, so this
      // line appearing means it genuinely got sent.
      await expect(page.getByText(PERSONA_MARK, { exact: false }),
        'the persona the owner wrote for this role is in the prompt the model got')
        .toBeVisible({ timeout: 20_000 });
      await request.dispose();
    });

  // UX-66 -- the header literally instructs "you are the owner, answer in first person",
  // yet never once states who the owner is. Identity has always been a **side effect** of
  // retrieval: the public identity used to be able to read the entire wiki, and any note
  // at all would surface the person's name. Once the public slice narrowed to only what
  // the owner had actually published, this AI would tell a stranger "there's no one named
  // Sijie in my notes". The name comes from the owner's own record, independent of corpus
  // scope -- hence the criterion here: **even with no owner name anywhere in this role's
  // corpus, the name must still reach the model**.
  test('the model is told who the owner is, even though no note says so',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      const tag = await scriptMockReplyText(request, 'noted.');
      await enterCodeSession(page, CODE, 'Reader');
      await page.getByTestId('chat-input-field').fill(`who are you ${tag}`);
      await page.getByTestId('chat-input-field').press('Enter');

      await expect(page.getByText(OWNER.fullName, { exact: false }),
        'the prompt the model got says the owner is ' + OWNER.fullName)
        .toBeVisible({ timeout: 20_000 });
      await request.dispose();
    });
});

async function initOwner(playwright: Playwright): Promise<string> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'persona-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'persona intro.', title: 'Persona Intro',
  });
  const id = await createRoleWithPersona(request, csrf);
  await createCode(request, csrf, { code: CODE, label: 'Persona', assumed_role_id: id });
  await request.dispose();
  return id;
}

// createRoleWithPersona -- a role carrying a prompt body. The persona is attached to the
// role through the prompts library, the same thing an owner does across
// /admin/prompts + /admin/roles.
async function createRoleWithPersona(
  request: APIRequestContext, csrf: string,
): Promise<string> {
  const backend = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
  const p = await request.post(`${backend}/api/admin/prompts`, {
    headers: { 'X-Csrftoken': csrf },
    data: { name: 'persona-body', body: `${PERSONA_MARK}. Speak plainly and cite the ledger.` },
  });
  if (!p.ok()) throw new Error(`create prompt failed: ${p.status()}`);
  const prompt = await p.json() as { id: string };
  const r = await request.post(`${backend}/api/admin/roles`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: ROLE, description: 'carries a persona', greeting: '',
      prompt_id: prompt.id, corpus_uris: ['wiki://**'],
      skill_ids: [], mcp_server_ids: [], dock_buttons: [], waypoints: [],
    },
  });
  if (!r.ok()) throw new Error(`create role failed: ${r.status()}`);
  const role = await r.json() as { id: string };
  return role.id;
}
