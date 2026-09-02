// chat-compaction-keeps-evidence.spec.ts -- F-D-10 second half: **compaction
// squeezes out this turn's evidence, so the answer becomes filler.**
//
// Really happened in prod (2026-08-17, real third-party MCP): two tools ran
// and returned 374871 + 3505 bytes, immediately followed by the log line
// `context compacted before_msgs:5 after_msgs:2`, and then the AI's entire
// reply was
// *"I'm here — what would you like to dig into next?"* -- the question went
// unanswered.
//
// Traced to the mechanism: compaction's tail step `finalizeKeepingTail` ->
// `tailPlainTurns` **deliberately skips tool calls and tool results** (keeping
// the result but dropping the call makes the provider reject the whole
// request). So the tool trace is guaranteed to vanish in compaction, and
// **the only thing that can carry it forward is the summary**; but the
// summary's instruction, `compactionUserInstruction`, has five clauses all
// about conversational facts, and not one word about what the tools returned.
//
// **This guard only checks "was the right thing asked", not "was the right
// thing answered"**, and that's not laziness: the stand-in never actually
// summarizes (the mock echoes any request it wasn't registered for, and the
// echo contains everything), so "the summary kept the evidence" would be
// **unconditionally true** on this side -- a false green
// ([[stand-in-is-politer-than-reality]]). The other half of the outcome
// belongs to eval (the real model) -- see findings.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { gatewayRequestExists, scriptMockReplyText, sendAndDrain } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'compaction@example.com', password: 'correct-horse-battery-staple',
  handle: 'compaction', fullName: 'Compaction Owner',
};
const CODE = 'COMPACT-001';

// COMPACTION_MARK -- the instruction's own opening line; only the compaction
// request carries it. A hit = compaction actually ran.
const COMPACTION_MARK = 'Condense the conversation so far';

// EVIDENCE_CLAUSE -- the instruction's clause **asking for what the tools
// actually returned**. This is the line this guard is after.
const EVIDENCE_CLAUSE = 'What any tools returned';

test.describe.serial('F-D-10 · compaction is told to keep the evidence', () => {
  let request: APIRequestContext;
  let session: VisitorSession;

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    request = await playwright.request.newContext({ timeout: 30_000 });
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'compaction-role', description: 'compaction spec', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'compaction', assumed_role_id: role.id, max_turns_per_session: 20,
    });
    session = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Verbose Vera',
    });
  });

  test.afterAll(async () => { await request.dispose(); });

  test('the summariser is asked for what the tools returned', async () => {
    test.setTimeout(180_000);
    // Push the context past 32k: a long piece of text a **visitor would
    // actually paste** (a job description / a spec).
    // Not trying to overwhelm anything -- this is exactly the action the
    // product invites.
    const bulk = 'The role we are hiring for, described at length. '.repeat(3000);
    const first = await scriptMockReplyText(request, 'noted');
    await sendAndDrain(request, session, `${bulk}${first}`);

    const second = await scriptMockReplyText(request, 'still noted');
    await sendAndDrain(request, session, `So what do you make of it?${second}`);

    // First prove "compaction actually happened" -- otherwise the assertion
    // below is checking emptiness on a branch that never ran
    // ([[assertion-that-cannot-fail]]). **Query by content, not by tag**:
    // compaction is its own call, and querying by tag would pick up that
    // turn's own request instead (the first version of this went red on the
    // query, not the product).
    await expect.poll(
      async () => gatewayRequestExists(request, COMPACTION_MARK),
      { timeout: 60_000, message: 'compaction ran at all' },
    ).toBe(true);

    expect(
      await gatewayRequestExists(request, EVIDENCE_CLAUSE),
      'the summariser is told to carry the tool results forward — the tool trace itself cannot '
      + 'survive compaction, so that summary is the only place the evidence can live, and a turn '
      + 'that loses it answers "what would you like to dig into next?" instead of the question',
    ).toBe(true);
  });
});
