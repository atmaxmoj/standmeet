// agent-skills-grant.ts —— admin REST helpers for issuing access codes
// that grant specific agent skills (with optional max_bookings quota).
// Also exposes a debug endpoint to inspect which tools a visitor session
// actually has access to — that's how the "tool gated" specs assert.

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface IssueCodeInput {
  label?: string;
  granted_skills?: readonly string[];
  max_bookings?: number;            // null/undefined = unlimited
  max_sessions_per_member?: number;
  max_turns_per_session?: number;
}

export interface IssuedCode {
  id: string;
  code: string;                     // plaintext
  granted_skills: readonly string[];
  max_bookings: number | null;
}

export async function issueCodeWithSkills(
  request: APIRequestContext, csrf: string, input: IssueCodeInput = {},
): Promise<IssuedCode> {
  const res = await request.post(
    `${BACKEND}/api/admin/codes`,
    {
      data: {
        label: input.label ?? 'gcal-spec',
        granted_skills: input.granted_skills ?? [],
        max_bookings: input.max_bookings ?? null,
        max_sessions_per_member: input.max_sessions_per_member ?? 10,
        max_turns_per_session: input.max_turns_per_session ?? 50,
      },
      headers: { 'X-Csrftoken': csrf },
    },
  );
  if (res.status() !== 200 && res.status() !== 201) {
    throw new Error(`issue code: ${res.status()}`);
  }
  return await res.json() as IssuedCode;
}

// ─── tool-spec inspection (dev/test only endpoint) ──────────────

interface SessionToolSpecs {
  tools: readonly { name: string }[];
}

/** Assert calendar.book is (or isn't) in the assembled tool spec for
 *  a session. Internally hits a dev-only debug endpoint the backend
 *  exposes when running in test mode. */
export async function expectCalendarBookExposed(
  request: APIRequestContext, sessionToken: string, exposed: boolean,
): Promise<void> {
  const res = await request.get(
    `${BACKEND}/internal/test/visitor-tool-specs`,
    { headers: { 'X-Session-Token': sessionToken } },
  );
  if (res.status() !== 200) throw new Error(`tool specs: ${res.status()}`);
  const spec = await res.json() as SessionToolSpecs;
  const names = spec.tools.map((t) => t.name);
  const has = names.includes('calendar.book');
  if (has !== exposed) {
    throw new Error(
      `expected calendar.book ${exposed ? 'exposed' : 'absent'}, ` +
      `got tools=${names.join(',')}`,
    );
  }
}
