// corpus-owner-only.spec.ts —— the note-level owner tier (subjectivity-owner-visibility).
//
// Motivating event: subjectivity/ gained its first RECORD note — a CV (real name, education,
// employers, city). PII entered a corpus StandMeet serves to visitors, and neither existing gate
// stops it:
//   * gate 2 (show_as_source) hides ATTRIBUTION, not INFORMATION — an agent that read the CV can
//     still state the employer in its answer.
//   * gate 1 is an allow-only glob list — one `subjectivity://**` grant admits the record note
//     along with the stances.
//
//   readable(note) = MatchesAnyCorpusGlob(role_globs, uri)  AND  NOT note.owner_only
//
// The role here grants `subjectivity://**` ON PURPOSE: that is the whole point. A test whose role
// simply didn't grant subjectivity would pass without the feature existing at all.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  BACKEND, claimSyncOwner, syncOwner, syncSession, syncRead, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('owneronly');

// EMPLOYER —— a distinctive token standing in for the CV's PII. Every assertion below hunts for
// THIS string: the question is never "did the call fail" but "can the visitor reach the fact".
const EMPLOYER = 'ACMECORP-CONFIDENTIAL-EMPLOYER';

// RECORD_NOTE —— the CV's shape: a subjectivity note marked owner-only.
const RECORD_NOTE = {
  rel: 'subjectivity/cv.md',
  body: makeVaultMD(
    { tags: ['fact', 'cv'], visibility: 'owner' },
    `Sijie Wang. Worked at ${EMPLOYER} as a staff engineer. Lives in Shanghai.`,
  ),
};

// STANCE_NOTE —— an ordinary subjectivity note (no owner tier): the control. It must stay readable,
// or the test would also pass by breaking subjectivity retrieval altogether.
const STANCE_NOTE = {
  rel: 'subjectivity/standpoint.md',
  body: makeVaultMD({ tags: ['node'] }, 'A collaboration needs a seat that can arbitrate.'),
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('corpus · note-level owner tier (PII stops at gate 1)', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    // grants subjectivity://** — the owner tier must hold DESPITE a matching glob.
    await claimSyncOwner(request, OWNER);
    await uploadVault(request, OWNER, [RECORD_NOTE, STANCE_NOTE], { authoritative: true });
    await request.dispose();
  });

  test('an owner-only note is unreadable even though the role grants its glob', ownerOnlyUnreadable);
  test('an owner-only note never appears in search results', ownerOnlyUnsearchable);
  test('a normal subjectivity note is still reachable (the control)', stanceStillReadable);
  test('dropping `visibility: owner` makes it readable again (the gate is what blocks)', liveToggle);
});

// visitorTool —— call a visitor tool as a code-holder and return the RAW text, so an assertion can
// hunt for the PII string anywhere in the response shape (hit list, snippet, title, path).
async function visitorTool(
  request: APIRequestContext, tool: string, args: Record<string, unknown>,
): Promise<string> {
  const sess = await syncSession(request, OWNER);
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${tool}`,
    { headers: { Authorization: `Bearer ${sess.session_token}` }, data: args },
  );
  return await res.text();
}

// ownerOnlyUnreadable —— the core claim: corpus_read cannot reach the record note, and above all
// the EMPLOYER string never comes back, even though the role's glob matches its URI.
async function ownerOnlyUnreadable({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const read = await syncRead(request, await syncSession(request, OWNER), 'cv');
  expect(read.error ?? '', 'an owner-only note reads as not-found/denied').toMatch(
    /not found|access denied/i,
  );
  expect(read.body ?? '', 'the PII body must not come back').not.toContain(EMPLOYER);
  await request.dispose();
}

// ownerOnlyUnsearchable —— search is the other way into context. A hit would leak the title/path
// even if the body were withheld, and its snippet would carry the PII outright.
async function ownerOnlyUnsearchable({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const out = await visitorTool(request, 'corpus_search', { query: EMPLOYER });
  expect(out, 'the record note must not surface as a search hit').not.toContain(EMPLOYER);
  expect(out, 'not even its title/path').not.toMatch(/\bcv\b/i);
  await request.dispose();
}

// stanceStillReadable —— the control. Without it, this suite would also go green if subjectivity
// retrieval were simply broken, which is the failure mode that would fake a PII fix.
async function stanceStillReadable({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const read = await syncRead(request, await syncSession(request, OWNER), 'standpoint');
  expect(read.genre, 'an ordinary subjectivity note is still admitted').toBe('subjectivity');
  expect(read.body ?? '', 'and its body is served').toContain('arbitrate');
  await request.dispose();
}

// liveToggle —— proves the OWNER TIER is what blocks (not some unrelated admission failure), and
// that it is live: re-syncing the same note without the flag makes it readable again. Also pins the
// reconcile trap — frontmatter is stripped out of body, so only owner_only changes between these
// two syncs; if reconcile ignored the field the note would be judged "unchanged" and skipped.
async function liveToggle({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const openVersion = {
    rel: 'subjectivity/cv.md',
    body: makeVaultMD(
      { tags: ['fact', 'cv'] }, // no `visibility: owner`
      `Sijie Wang. Worked at ${EMPLOYER} as a staff engineer. Lives in Shanghai.`,
    ),
  };
  await uploadVault(request, OWNER, [openVersion, STANCE_NOTE], { authoritative: true });

  const read = await syncRead(request, await syncSession(request, OWNER), 'cv');
  expect(read.body ?? '', 'without the flag the same note IS readable — the gate is the cause')
    .toContain(EMPLOYER);
  await request.dispose();
}
