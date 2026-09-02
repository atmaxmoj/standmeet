// connector-single-gate-consistency.spec.ts -- §1 the single gate is consistent across all three walks
//
// D-2: connector gating is collapsed into `enabledCaps` (the global single
// gate). All three visitor "walks" read that one gate, so an unconnected
// connector must produce the SAME answer on all three surfaces:
//   1. the issued session's `tool_specs`         (no calendar_book)
//   2. the session's `capabilities` states       (no calendar.book entry)
//   3. the system-prompt `part_ids`              (no booking fragment)
//
// One unconnected state → consistent absence everywhere. If gating lives in
// three places (a booker cap self-check, a separate tool-spec filter, a
// separate prompt-fragment selector) they can drift: tool hidden but cap still
// listed, or fragment still injected. This spec is the drift detector.
//
// RED / TDD: before gating is unified through the single global gate, the
// three surfaces are computed by different code paths and at least one will
// disagree when calendar is unconnected → assertion fails. Expected.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { seedOwnerCredentialed, OWNER } from '@/fixtures/gcal-setup';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { issueSession } from '@/fixtures/visitor';
import type { SessionCapability, VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// The booking capability id (dotted) + its tool name (snake_case) +
// its prompt fragment id.
const BOOK_CAP_ID = 'calendar.book';
const BOOK_TOOL_NAME = 'calendar_book';
const BOOK_FRAGMENT_ID = 'capabilities/calendar.book';

interface DiagSession {
  tool_specs: readonly { name: string }[];
  capabilities: SessionCapability[];
}

async function fetchDiag(
  request: APIRequestContext, sessionToken: string,
): Promise<DiagSession> {
  const res = await request.get(`${BACKEND}/internal/diag/session`, {
    headers: { 'X-Session-Token': sessionToken },
  });
  if (res.status() !== 200) throw new Error(`diag session: ${res.status()}`);
  return await res.json() as DiagSession;
}

function partIDs(sess: VisitorSession): string[] {
  if (!sess.system_prompt_part_ids) {
    throw new Error('response missing system_prompt_part_ids[]');
  }
  return sess.system_prompt_part_ids;
}

test.describe('connector dep · one unconnected state → consistent absence on all three walks', () => {
  let request: APIRequestContext;
  let csrf: string;
  let code: string;

  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    // Owner has calendar CREDENTIALS but is NOT connected (no OAuth). This is
    // the canonical "unconnected" state the global gate must reject.
    const seed = await seedOwnerCredentialed(playwright);
    request = seed.request;
    csrf = seed.csrf;
    const issued = await issueCodeWithSkills(request, csrf, {
      granted_skills: ['calendar.book'],
    });
    code = issued.code;
  });

  test.afterAll(async () => { await request.dispose(); });

  test('calendar NOT connected → no calendar_book tool, no calendar.book cap entry, no booking fragment',
    async () => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code, visitor_name: 'V',
      });
      const diag = await fetchDiag(request, sess.session_token);

      // walk 1 — tool_specs (VisitorToolSpecs)
      const toolNames = diag.tool_specs.map((t) => t.name);
      expect(toolNames, 'walk 1: calendar_book absent from tool_specs')
        .not.toContain(BOOK_TOOL_NAME);

      // walk 2 — capabilities states (VisitorStates). Single-gate means an
      // unconnected dep removes the cap from enabledCaps entirely — not a
      // visible-but-disabled entry (D-1: unconnected = fully hidden, not degraded-visible).
      const bookCap = (sess.capabilities ?? []).find((c) => c.id === BOOK_CAP_ID);
      expect(bookCap, 'walk 2: calendar.book cap not present when unconnected')
        .toBeUndefined();
      const diagBookCap = diag.capabilities.find((c) => c.id === BOOK_CAP_ID);
      expect(diagBookCap, 'walk 2 (diag): same shape, calendar.book absent')
        .toBeUndefined();

      // walk 3 — system-prompt part_ids (AssembleVisitor)
      expect(partIDs(sess), 'walk 3: booking fragment id absent from part_ids')
        .not.toContain(BOOK_FRAGMENT_ID);

      // consistency: session.capabilities and diag.capabilities are the same
      // Registry source, so they must agree on calendar.book's absence too.
      const sessHasBook = (sess.capabilities ?? []).some((c) => c.id === BOOK_CAP_ID);
      const diagHasBook = diag.capabilities.some((c) => c.id === BOOK_CAP_ID);
      expect(sessHasBook, 'both walks computed from one gate → same answer')
        .toBe(diagHasBook);
    });
});
