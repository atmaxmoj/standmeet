// transcript-grounding-visible.spec.ts -- F-A-27: the owner must be able to see their
// own standpoint notes actually working.
//
// subjectivity notes are designed to **shape the voice without entering the visitor
// footer** (chat-subjectivity check 3) -- that part is deliberate. But elsewhere,
// tool-call-shape.ts:19 assumes "what got read" is carried by the citations footer --
// two decisions that each hold up on their own combine to make read-events for that
// entire genre **exist nowhere at all**: the visitor's log has a count but no genre,
// the owner's record only lists citations, and private notes get dropped by the
// show_as_source gate before they ever reach the DB.
//
// So the owner writes a whole set of standpoint notes to shape the voice, with no way
// to tell whether any of them ever did anything -- and this is exactly the observation
// point chat-subjectivity check 1 was missing.
//
// This guards two things, and both must hold **at the same time**, or the fix either
// does nothing or leaks:
//   1. a non-opt-in subjectivity note shows up in the grounding section of the owner's
//      record (its title is visible);
//   2. it **never** shows up on the visitor side -- the visitor's citation footnotes
//      must not change by even one character.
//
// RED (before the fix): the grounding section doesn't exist -> the first case goes red.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';
import { gotoAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'grounding@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'grounding',
  fullName: 'Grounding Owner',
};
const CODE = 'GROUND-001';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// A private standpoint note: show_as_source=false by default -- shapes the voice, does
// not enter the visitor footer. Its path comes from subjectivity_write's response
// (tree-derived), never hand-assembled.
const STANCE_TITLE = 'verify-stance';
let stancePath = '';

// A second standpoint note, this one **opt-in** (show_as_source=true): it really does
// enter the citation list, i.e. `messages.cited_subjectivity_ids`. This is exactly what
// F-A-39 guards -- one turn in prod cited 6 subjectivity notes, and the owner's
// transcript showed not a single citation line for any of them.
const CITABLE_TITLE = 'verify-stance-public';
let citablePath = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

let seeded: { request: APIRequestContext; sid: string; apiToken: string } | null = null;

test.describe.serial('transcript · the owner can see which standpoint notes grounded a turn (F-A-27)', () => {
  test.beforeAll(async ({ playwright }) => {
    seeded = await setup(playwright);
  });

  test.afterAll(async () => {
    await seeded?.request.dispose();
  });

  test('a grounded (non-opt-in) subjectivity note shows up in the owner transcript',
    async ({ adminPage, playwright }) => {
      const request = await playwright.request.newContext();
      const session = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Grounded',
      });
      // Scripted: this turn's assistant goes and reads that private standpoint note.
      const tag = await scriptMockToolCall(request, {
        name: 'corpus_read', args: { path: stancePath },
      });
      await sendAndDrain(request, session, `what do you actually think${tag}`);

      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.getByText('Grounded', { exact: true }).click();
      const modal = adminPage.getByTestId('transcript-body');
      await expect(modal).toBeVisible({ timeout: 10_000 });

      // Asserting the title is visible -- "did it actually do anything" is exactly
      // what the owner needs to judge, and a bare count can't answer that.
      await expect(
        modal.getByTestId('transcript-grounding'),
        'the transcript must name the standpoint notes that shaped the turn',
      ).toContainText(STANCE_TITLE);

      await request.dispose();
    });

  // F-A-39: a subjectivity note that gets **cited** must also be visible on the
  // owner's transcript.
  //
  // This is the other half of the same item as the test above: that one guards "was
  // grounded but never cited" (a private note, shaping voice), this one guards "already
  // made it into the citation list" -- one turn actually captured in prod had 6 entries
  // in `cited_subjectivity_ids`, while its transcript showed **not a single citation
  // line**; other turns on the same page that only cited wiki listed all five lines as
  // normal. The data was in the DB; the UI was throwing it away
  // (`ConvTranscriptModal` only hands wikiIds/outputIds to CitedTail).
  //
  // Asserts on **the title**, not "how many lines": what the owner needs to recognize
  // is "which notes exactly", and a number can't answer that.
  test('a cited subjectivity note is named in the owner transcript', citedStanceIsNamed);

  // F-A-28: the visitor side must get not one character of it.
  //
  // This one started red for a reason unrelated to F-A-27 -- the visitor's own
  // GET /api/v1/conversations/{id} echoes the stored tool_calls back verbatim, and
  // inside them is corpus_read's full result, including this private standpoint note's
  // **body**, along with its own `"show_as_source":false`. The same response's citations
  // field is empty: the citation gate was implemented correctly, and tool_calls simply
  // routed around it. The same holds during live streaming (sseSink.ToolCompleted pushes
  // the full result in real time).
  //
  // Asserts on the whole payload, not on the citations array: the array only covers one
  // channel, and the essence of this defect is exactly "the other channel".
  test('the visitor still never sees it', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const session = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Outsider',
    });
    const tag = await scriptMockToolCall(request, {
      name: 'corpus_read', args: { path: stancePath },
    });
    await sendAndDrain(request, session, `same question${tag}`);

    // Fetches the exact response the visitor gets on reload -- not some return value
    // already sitting in a local variable. sendAndDrain returns void; running that
    // through JSON.stringify yields undefined, and an assertion against that would
    // neither pass nor meaningfully fail -- it would just look like it was guarding
    // something.
    const res = await request.get(
      `${BACKEND}/api/v1/conversations/${session.conversation_id}`,
      { headers: { 'X-Session-Token': session.session_token } },
    );
    expect(res.status(), 'the visitor can load their own conversation').toBe(200);
    const body = await res.text();

    // Prove this response **isn't empty** first, or "the title isn't in it" would just
    // be a false green from an empty set.
    expect(body, 'guard: the turn really is in the visitor view').toContain('same question');
    // No field is allowed to carry the private standpoint note out -- asserting only
    // "not in the citations array" would miss it leaking through anywhere else, so the
    // whole payload is checked as one.
    expect(
      body.toLowerCase(),
      'a private standpoint note must not reach the visitor by any field',
    ).not.toContain(STANCE_TITLE);
    await request.dispose();
  });
});

// citedStanceIsNamed -- see the explanation above (F-A-39).
async function citedStanceIsNamed(
  { adminPage, playwright }: { adminPage: Page; playwright: Playwright },
): Promise<void> {
  const request = await playwright.request.newContext();
  const session = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'Cites Stance',
  });
  const tag = await scriptMockToolCall(request, {
    name: 'corpus_read', args: { path: citablePath },
  });
  await sendAndDrain(request, session, `where does taste come in${tag}`);

  await gotoAdminSection(adminPage, 'conversations');
  await adminPage.getByText('Cites Stance', { exact: true }).click();
  const modal = adminPage.getByTestId('transcript-body');
  await expect(modal).toBeVisible({ timeout: 10_000 });
  // Prove this turn actually landed in the transcript first, or the assertion below
  // is just looking for something inside an empty modal.
  await expect(modal, 'the turn is in the transcript').toContainText('where does taste come in');

  await expect(
    modal,
    'a cited subjectivity note must be named in the transcript — the owner has to know '
      + 'WHICH notes were cited, and a count cannot answer that',
  ).toContainText(CITABLE_TITLE, { timeout: 10_000 });

  await request.dispose();
}

async function setup(
  playwright: Playwright,
): Promise<{ request: APIRequestContext; sid: string; apiToken: string }> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'grounding-seed');
  const sid = await initMCP(request, apiToken);
  // subjectivity_write writes one private standpoint note (not opt-in by default).
  // Its path uses the tree-derived value from the tool's own response.
  const wrote = await callTool<{ subjectivity_id: string; path: string }>(
    request, apiToken, sid, 'subjectivity_write',
    {
      title: STANCE_TITLE, tags: [],
      body: 'I would rather be wrong out loud than vague on purpose.',
    },
  );
  stancePath = wrote.path;
  const citable = await callTool<{ subjectivity_id: string; path: string }>(
    request, apiToken, sid, 'subjectivity_write',
    {
      title: CITABLE_TITLE, tags: [], show_as_source: true,
      body: 'Taste is the part of the work that cannot be delegated.',
    },
  );
  citablePath = citable.path;
  const role = await createRole(request, csrf, {
    name: 'grounding-role', description: 'grounding spec',
    corpus_uris: ['subjectivity://**', 'wiki://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'grounding', assumed_role_id: role.id,
  });
  return { request, sid, apiToken };
}
