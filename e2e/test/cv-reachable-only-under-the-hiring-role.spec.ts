// cv-reachable-only-under-the-hiring-role.spec.ts —— the CV enters the corpus, but only the
// hiring path can see it.
//
// Defect (found during a mock interview run on 2026-08-30): `subjectivity/cv.md` lives in
// the vault, but was **deliberately never synced into the production corpus** (it contains
// PII: real name, school, employer, city). So the flagship path is structurally unable to
// answer the question recruiters ask most — "where did you work before, and for how long".
// The agent handles this gracefully (explicitly refuses to make things up, see Q8 from that
// run), but a graceful non-answer is still a non-answer.
//
// The owner decided on option A: the CV enters the corpus, marked non-public, reachable only
// under the hiring role. No new mechanism needed — that's exactly what a role's
// `corpus_uris` is for.
//
// The criterion has to come in a pair, and **the positive control must run first**:
//   writing only the "public visitors can't read it" half means this test would already be
//   green today, when the CV isn't even synced yet — an always-true deny assertion ("red for
//   no discernible reason gets mistaken for red for the right reason"). So first prove the
//   hiring path can **actually retrieve the employer and the dates**; only once that half is
//   red does the deny half get to speak.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { createEntry } from '@/fixtures/genre-assets';
import { getRoleByName } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueByoaiSession, issueSession } from '@/fixtures/visitor';
import { grepTitles, searchTitles } from '@/fixtures/retrieval';

const OWNER = {
  email: 'cvowner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'cvowner',
  fullName: 'Cee Vee',
};

// The CV is a **subjectivity** entry, not a wiki note.
//
// The first version seeded it as wiki under the path `subjectivity/cv` — but `invited` grants
// `wiki://**`, so **every code the product ever issues** (gate-approved codes included) could
// see this PII. The test caught it on the spot. subjectivity is a separate scheme, already
// outside invited by default; the `hiring` role then explicitly grants the single
// `subjectivity://cv` URI.
const CV_TITLE = 'cv';
// Criterion anchor: the two things a recruiter actually needs — the employer name + the
// start/end dates. Without these two in the corpus, this path is still unable to answer,
// even once the CV "file" itself is synced in.
const EMPLOYER = 'Northwind Logistics';
const TENURE = '2019-03 → 2022-11';
const CV_BODY = [
  '# Curriculum Vitae',
  '',
  `## ${EMPLOYER} — Senior Backend Engineer`,
  `${TENURE} · Hamilton, ON`,
  '',
  'Owned the dispatch pipeline and its verification harness.',
].join('\n');

test.describe('corpus · the CV is in the corpus, and only the hiring role can reach it', () => {
  let hiringCode = '';
  let plainCode = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'cv-acl-spec');
    const sid = await initMCP(request, token);

    // The CV enters the corpus — through the subjectivity write port (the self-model the
    // owner writes with their own AI).
    await createEntry({ request, token, sid }, 'subjectivity', CV_TITLE, CV_BODY);

    // Both roles use **the two builtins the product itself seeds**, not something the test
    // makes up on the spot. Making them up would test a glob I hand-assembled, not the real
    // grant list an owner actually gets ([[which-path-is-the-green-on]]).
    const hiring = await getRoleByName(request, 'hiring');
    const plain = await getRoleByName(request, 'invited');

    hiringCode = (await createCode(request, csrf, {
      code: 'HIRING-CV', label: 'hiring', assumed_role_id: hiring.id,
    })).code;
    plainCode = (await createCode(request, csrf, {
      code: 'PLAIN-CV', label: 'plain', assumed_role_id: plain.id,
    })).code;
    await request.dispose();
  });

  // ── positive control runs first: the hiring path must actually retrieve the employer and
  // dates ──────────────────
  test('a hiring-role visitor can retrieve the employer and the dates',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: hiringCode, visitor_name: 'Recruiter Bob',
      });

      // The entry can be found.
      expect(await searchTitles(request, sess, EMPLOYER)).toContain(CV_TITLE);
      // And the two specific facts inside it can actually be extracted — "the file can be
      // found" is not the same as "the question can be answered".
      const hits = await grepTitles(request, sess, TENURE);
      expect(hits).toContain(CV_TITLE);
    });

  // ── with the positive control in place, the deny half now means something
  // ────────────────────────────────
  test('an ordinary code cannot reach the CV at all',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: plainCode, visitor_name: 'Ordinary Olive',
      });
      expect(await searchTitles(request, sess, EMPLOYER)).not.toContain(CV_TITLE);
      expect(await grepTitles(request, sess, TENURE)).not.toContain(CV_TITLE);
    });

  // Visitors have **three tiers** (CLAUDE.md: access code / BYOAI / gate). The two tests
  // above only cover the code tier and the anonymous tier — BYOAI is the third tier: it
  // brings its own key and should only ever see the corpus's public slice.
  // Skipping a tier means guarding one fewer door, and PII only needs one open door.
  test('a BYOAI visitor cannot reach the CV either',
    async ({ request }) => {
      const sess = await issueByoaiSession(request, {
        handle: OWNER.handle, byoai_provider: 'anthropic',
        byoai_key: 'sk-visitor-supplies-their-own',
        byoai_endpoint: 'http://mock.byoai.local', byoai_model: 'mock-model-byoai',
        visitor_name: 'Bring Your Own Bob',
      });
      expect(await searchTitles(request, sess, EMPLOYER)).not.toContain(CV_TITLE);
      expect(await grepTitles(request, sess, TENURE)).not.toContain(CV_TITLE);
    });

  // Fourth tier: fully anonymous. No code, no BYOAI — just the public reader path.
  test('an anonymous public session cannot reach the CV either',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'public', visitor_name: 'Anonymous Ann',
      });
      expect(await searchTitles(request, sess, EMPLOYER)).not.toContain(CV_TITLE);
      expect(await grepTitles(request, sess, TENURE)).not.toContain(CV_TITLE);
    });
});

// Note: granting corpus_uris on the role only solves "can reach it". The agent also has to
// **know to look** — the hiring prompt needs a line telling it that the employer and dates
// live in the CV. That other half is covered by the persona assertion in
// jobloop-code-never-ships-bare.spec.ts.
