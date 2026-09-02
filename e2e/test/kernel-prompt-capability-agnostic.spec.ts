// kernel-prompt-capability-agnostic.spec.ts — a capability the visitor was not granted
// must not show up in their system prompt.
//
// Every turn, the kernel assembles a generic context block into the instruction: current
// time, the owner's timezone, the visitor's timezone. That block has nothing to do with
// "what was this visitor granted" — but it kept saying "the owner's **calendar** runs in
// this timezone" and "before proposing or **scheduling** times". So a visitor granted
// only corpus access, who can't even see a booking tool, still had a scheduling
// instruction sitting in their system prompt: the model could propose booking a time
// based on it, for a capability that doesn't exist at all.
//
// This is the last item on check-core-agnostic's baseline. The fix: the timezone
// **facts** stay in the kernel (résumé, experience, "recently" all need to anchor to
// today), while the **instructions** — how to convert it / when to ask back / whether to
// show both — go back to whichever capability actually handles scheduling, said in its
// own MCP instructions — appearing only once it's granted.
//
// The mock provider echoes back the system prompt it received verbatim as `[system:...]`
// (see composeFinalReply in mock-stack/llm-gateway), so what's asserted here is **the
// prompt actually sent to the model**, not diag's snapshot — that context block is
// assembled fresh every turn, and diag's snapshot never shows it at all.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'kernelprompt@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'kernelprompt',
  fullName: 'Kernel Prompt Owner',
};

const CODE = 'KERNEL-PROMPT-001';

// Words specific to a concrete capability. This visitor has no scheduling tool at all,
// so none of these should appear in their system prompt.
const CAPABILITY_WORDS = /calendar|schedul|book a meeting|appointment/i;

test.describe('the always-on part of the system prompt names no capability', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await grantCorpusOnlyCode(request);
    await request.dispose();
  });

  test('a visitor granted only corpus carries no scheduling instruction', async ({ request }) => {
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Curious Reader',
    });
    const res = await sendMessage(request, sess, 'what does the owner work on?');
    expect(res.status()).toBe(200);
    const body = await res.text();

    // First prove we actually got to see that prompt — if the echo were missing, the
    // "does not contain" assertion below would go green for nothing.
    expect(body, 'the mock echoes the system prompt it received').toContain('[system:');
    expect(body, 'the generic time anchor is still injected').toContain('Current date and time:');

    expect(
      body,
      'this visitor has no booking tool — nothing in their prompt should talk about scheduling',
    ).not.toMatch(CAPABILITY_WORDS);
  });
});

// grantCorpusOnlyCode — a role + code that grants corpus access only, no capabilities.
async function grantCorpusOnlyCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'reader-only',
    description: 'corpus only, no capabilities',
    corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'corpus-only reader', assumed_role_id: role.id,
  });
}
