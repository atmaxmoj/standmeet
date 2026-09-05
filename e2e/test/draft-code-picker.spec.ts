// draft-code-picker.spec.ts —— the composer's code picker (docs/design/resume-customization.md).
// The résumé's QR always carries an invitation (AccessCode === invitation); the picker chooses
// WHICH code: issue a fresh one (default), or reuse an existing active code. Proven end to end
// through the real commit endpoint:
//   - code_mode "new"      → a fresh code is issued and printed in the QR;
//   - code_mode "existing" → the QR carries the chosen code, and NO new code is issued.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { resumeDraft, sampleResumeContent } from '@/fixtures/resume';
import { createCode } from '@/fixtures/codes';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'code-picker@example.com', password: 'correct-horse-battery-staple',
  handle: 'codepicker', fullName: 'Code Picker Owner',
};

interface Committed { access_code: string; qr_url: string }

let ctx: APIRequestContext;
let csrf = '';
let token = '';
let sid = '';
const cacheIDs: string[] = [];

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · code picker (issue new vs reuse existing)', () => {
  test.beforeAll(async ({ playwright }) => { await setup(playwright); });

  test('code_mode new issues a fresh code; existing reuses one and issues none', async () => {
    // NEW: a fresh code is issued and it's the one in the QR.
    const d1 = await newDraft(0);
    const committedNew = await commit(d1, { code_mode: 'new', code_id: '' });
    expect(committedNew.access_code, 'a fresh code was issued').not.toBe('');
    expect(committedNew.qr_url, 'the QR carries the issued code')
      .toContain(`?code=${committedNew.access_code}`);

    // EXISTING: reuse a code the owner already has → the QR carries it, no new code appears.
    const existing = await createCode(ctx, csrf, { code: 'REUSE-ME-01', label: 'Reuse' });
    const before = await codeCount();
    const d2 = await newDraft(1);
    const committedReuse = await commit(d2, { code_mode: 'existing', code_id: existing.id });
    expect(committedReuse.access_code, 'the reused code, not a fresh one').toBe(existing.code);
    expect(committedReuse.qr_url).toContain(`?code=${existing.code}`);
    expect(await codeCount(), 'reusing an existing code issues no new code').toBe(before);
  });
});

async function setup(playwright: Playwright): Promise<void> {
  await claimFreshOwner(playwright, OWNER);
  ctx = await playwright.request.newContext();
  ({ csrf } = await loginAPI(ctx, OWNER.email, OWNER.password));
  token = await createAPIToken(ctx, csrf, 'code-picker-seed');
  sid = await initMCP(ctx, token);
  const src = await jobsRegisterSource(ctx, token, sid, {
    kind: 'greenhouse', label: 'Code Picker Board', config: { company: 'anthropic' },
  });
  const { jobs } = await jobsFetchNew(ctx, token, sid, src.id);
  expect(jobs.length, 'the mock board returns jobs to draft against').toBeGreaterThan(1);
  for (const j of jobs) cacheIDs.push(j.cache_id);
}

async function newDraft(i: number): Promise<string> {
  const drafted = await resumeDraft(ctx, token, sid, cacheIDs[i]!, sampleResumeContent());
  return drafted.view.draft_id;
}

async function commit(
  draftID: string, body: { code_mode: string; code_id: string },
): Promise<Committed> {
  const res = await ctx.post(`${BACKEND}/api/admin/drafts/${draftID}/commit`, {
    headers: { 'X-Csrftoken': csrf }, data: body,
  });
  expect(res.status(), `commit ${body.code_mode}`).toBe(200);
  return res.json() as Promise<Committed>;
}

async function codeCount(): Promise<number> {
  const res = await ctx.get(`${BACKEND}/api/admin/codes/`, { headers: { 'X-Csrftoken': csrf } });
  expect(res.status()).toBe(200);
  return (await res.json() as unknown[]).length;
}
