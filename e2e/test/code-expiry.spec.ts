// code-expiry.spec.ts —— BLACK BOX. An access code's expiry is real and the owner can change it
// (owner, 2026-10-15: "我们的code没有ttl么？…update的ttl入口有么？").
//
// Found while answering: expires_at was stored and shown but never enforced — an expired code
// still opened sessions — and nothing could change it after creation (no op, no field in the panel).
//
// Contract:
//   - A code past its expires_at is refused at the door with code_expired; a live session on it
//     ends — at once when the owner sets a past expiry, within the "code expiry" periodic run when
//     the date simply passes.
//   - codes.set_expiry {code_id, expires_at | null} (MCP + panel) moves or clears it; null = never.
//   - The panel's code form sets the expiry at creation and on edit.
//   - A code bound to an ephemeral page follows the page's clock (docs/design/job-loop-retention.md):
//     its own date does not apply while the page is ephemeral, and applies again once it is forever.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { createCode } from '@/fixtures/codes';
import { allHistory, jobsAnnotate } from '@/fixtures/job-ledger';
import { execSQL } from '@/fixtures/instance';
import { callTool } from '@/fixtures/mcp';
import { bindCodeToPage } from '@/fixtures/microsite-rig';
import { gotoAdminSection } from '@/fixtures/navigate';
import { runPeriodicNow } from '@/fixtures/periodic';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const HANDLE = 'codeexpiry';
const DAY = 86_400_000;
const iso = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();

interface CodeRow { id: string; code: string; expires_at?: string; expiry_follows_page?: boolean }

let o: LoopOwner;

const tool = <T>(name: string, args: Record<string, unknown>): Promise<T> =>
  callTool<T>(o.request, o.apiToken, o.sid, name, args);
const setExpiry = (codeID: string, at: string | null): Promise<CodeRow> =>
  tool<CodeRow>('codes.set_expiry', { code_id: codeID, expires_at: at });
const listed = async (code: string): Promise<CodeRow | undefined> =>
  (await tool<{ items: CodeRow[] }>('codes.list', { limit: 200 })).items.find((c) => c.code === code);

async function enter(request: APIRequestContext, code: string): Promise<{ status: number; why: string; token: string }> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`,
    { data: { handle: HANDLE, mode: 'code', code, visitor_name: 'Recruiter' } });
  const body = await res.json().catch(() => ({})) as { error?: { code?: string }; session_token?: string };
  return { status: res.status(), why: body.error?.code ?? '', token: body.session_token ?? '' };
}

/** 401 when the session is gone; anything else means it is still alive. */
async function turnStatus(request: APIRequestContext, token: string): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`,
    { headers: { Authorization: `Bearer ${token}` }, data: {} });
  return res.status();
}

test.use({ ownerCredentials: { email: `${HANDLE}@example.com`, password: 'correct-horse-battery-staple' } });
test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, HANDLE);
});
test.afterAll(async () => { await o.request.dispose(); });

test('an expired code is refused at the door; moving the date lets the visitor in; null = never', async ({ request }) => {
  const code = await createCode(o.request, o.csrf, { code: 'EXP-DOOR', label: 'door' });
  await setExpiry(code.id, iso(-60_000));
  const refused = await enter(request, 'EXP-DOOR');
  expect(refused.status, 'refused').toBe(401);
  expect(refused.why, 'says it expired').toBe('code_expired');

  const moved = await setExpiry(code.id, iso(30 * DAY));
  expect(moved.expires_at, 'the receipt carries the new date').toBeTruthy();
  expect((await enter(request, 'EXP-DOOR')).status, 'in again').toBe(200);

  await setExpiry(code.id, null);
  expect((await listed('EXP-DOOR'))?.expires_at, 'never expires').toBeUndefined();
  expect((await enter(request, 'EXP-DOOR')).status).toBe(200);
});

test('setting a past expiry ends the live sessions at once', async ({ request }) => {
  const code = await createCode(o.request, o.csrf, { code: 'EXP-LIVE', label: 'live' });
  const s = await enter(request, 'EXP-LIVE');
  expect(s.status).toBe(200);
  expect(await turnStatus(request, s.token), 'presence: the session works').not.toBe(401);
  await setExpiry(code.id, iso(-60_000));
  expect(await turnStatus(request, s.token), 'the session ended').toBe(401);
});

test('when the date simply passes, the "code expiry" run ends the sessions and the door stays shut', async ({ request }) => {
  await createCode(o.request, o.csrf, { code: 'EXP-PASS', label: 'pass', expires_at: iso(DAY) });
  const s = await enter(request, 'EXP-PASS');
  expect(s.status).toBe(200);
  execSQL(`UPDATE access_codes SET expires_at = now() - interval '1 minute' WHERE code = 'EXP-PASS'`);
  expect((await enter(request, 'EXP-PASS')).why, 'the door is shut at once').toBe('code_expired');
  await runPeriodicNow(o, 'code expiry');
  expect(await turnStatus(request, s.token), 'the session ended').toBe(401);
});

test('the panel sets the expiry at creation and changes or clears it later', async ({ adminPage }) => {
  await gotoAdminSection(adminPage, 'codes');
  await adminPage.getByRole('button', { name: /new code/i }).click();
  await adminPage.getByTestId('code-input').fill('EXP-PANEL');
  await adminPage.getByTestId('code-label').fill('panel');
  await adminPage.getByTestId('code-expires').fill('2031-05-20');
  await adminPage.getByTestId('code-create').click();
  const expiry = adminPage.getByTestId('code-card-EXP-PANEL').getByTestId('code-expiry');
  await expect(expiry, 'the card shows the date').toContainText('2031-05-20', { timeout: 10_000 });

  await openEdit(adminPage, 'EXP-PANEL');
  await adminPage.getByTestId('code-expires').fill('2032-01-10');
  await adminPage.getByTestId('code-save').click();
  await expect(expiry).toContainText('2032-01-10', { timeout: 10_000 });
  expect((await listed('EXP-PANEL'))?.expires_at?.slice(0, 10), 'stored, not just shown').toBe('2032-01-10');

  await openEdit(adminPage, 'EXP-PANEL');
  await adminPage.getByTestId('code-expires').fill('');
  await adminPage.getByTestId('code-save').click();
  await expect(expiry).not.toContainText('2032', { timeout: 10_000 });
  expect((await listed('EXP-PANEL'))?.expires_at, 'cleared = never').toBeUndefined();
});

test('a code on an ephemeral page follows the page\'s clock; once the page is forever its own date applies', async ({ request }) => {
  const seen = (o.jobs[0] as { job_seen_id?: string }).job_seen_id!;
  await jobsAnnotate(o, seen, { reason: 'deal', retention: 'ephemeral' });
  const bundle = (await allHistory(o)).find((r) => r.job_seen_id === seen)!.bundle_id!;
  await tool('microsite.create', { slug: 'exp-room', retention: 'ephemeral', bundle_id: bundle });
  const code = await createCode(o.request, o.csrf, { code: 'EXP-ROOM', label: 'room' });
  await bindCodeToPage(o.request, o.csrf, code.id, 'exp-room');
  await setExpiry(code.id, iso(-60_000));

  expect((await listed('EXP-ROOM'))?.expiry_follows_page, 'the list says why').toBe(true);
  expect((await enter(request, 'EXP-ROOM')).status, 'its own date does not apply').toBe(200);

  await jobsAnnotate(o, seen, { retention: 'forever' });
  expect((await listed('EXP-ROOM'))?.expiry_follows_page).toBeFalsy();
  expect((await enter(request, 'EXP-ROOM')).why, 'forever now: its own date applies').toBe('code_expired');
});

async function openEdit(page: Page, code: string): Promise<void> {
  await page.getByTestId(`code-card-${code}`).getByRole('button', { name: 'edit', exact: true }).click();
}
