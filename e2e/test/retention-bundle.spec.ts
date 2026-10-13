// retention-bundle.spec.ts —— BLACK BOX, docs/design/job-loop-retention.md §4–5.
//
// One tentative send-out = an ephemeral assessment + a microsite + the code bound to it, on ONE
// clock (a bundle). A recruiter opening the page with the code keeps the assessment alive; a pin on
// any member keeps all; at expiry the page serves "expired", the code is revoked as expired, the
// assessment clears and the page waits in the trash; a commit makes the whole bundle forever.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { commitApplication, setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { createCode } from '@/fixtures/codes';
import { allHistory, jobsAnnotate } from '@/fixtures/job-ledger';
import { execSQL } from '@/fixtures/instance';
import { callTool } from '@/fixtures/mcp';
import { bindCodeToPage, publishPage } from '@/fixtures/microsite-rig';
import { openReader } from '@/fixtures/navigate';
import { clearedRecords, sweepRetention } from '@/fixtures/retention';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const DAY = 86_400_000;
const SLUG = 'deal-room';
const CODE = 'DEAL-ROOM-1';

interface Row { job_seen_id: string; bundle_id: string | null; retention: string; last_touched_at: string | null; cleared_at: string | null; reason?: string }
interface PageItem { slug: string; retention: string; bundle_id: string | null }

let o: LoopOwner;
let bundle = '';
let codeID = '';

const seenID = (n: number): string => (o.jobs[n] as { job_seen_id?: string }).job_seen_id!;
const rowOf = async (n: number): Promise<Row> =>
  (await allHistory(o)).find((r) => r.job_seen_id === seenID(n)) as unknown as Row;
const tool = <T>(name: string, args: Record<string, unknown>): Promise<T> =>
  callTool<T>(o.request, o.apiToken, o.sid, name, args);
const backdate = (days: number): void => {
  execSQL(`UPDATE retention_bundles SET last_touched_at = now() - interval '${days} days' WHERE id = '${bundle}'`);
};
const sweep = (): Promise<void> => sweepRetention(o);
const pageStatus = async (): Promise<{ status: number; body: string }> => {
  const res = await o.request.get(`${BACKEND}/api/v1/microsites/${SLUG}/`);
  return { status: res.status(), body: await res.text() };
};

async function enterWithCode(page: Page): Promise<void> {
  await openReader(page, `/?code=${CODE}`);
  const issued = page.waitForResponse((r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 20_000 });
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByTestId('visitor-name-input').fill('Recruiter');
  await page.getByTestId('visitor-name-submit').click();
  await issued;
  await expect(page.locator('[data-sm="marker"]'), 'on the deal room').toBeVisible({ timeout: 20_000 });
}

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(900_000);
  o = await setupLoopOwner(playwright, 'retentionbundle');
  await jobsAnnotate(o, seenID(0), { reason: 'ZEBRADEAL', retention: 'ephemeral' });
  bundle = (await rowOf(0)).bundle_id!;
  expect(bundle, 'presence: the assessment has a clock').toBeTruthy();
  await tool('microsite.create', { slug: SLUG, retention: 'ephemeral', bundle_id: bundle });
  await publishPage(o.request, o.csrf, SLUG);
  codeID = (await createCode(o.request, o.csrf, { code: CODE, label: 'deal' })).id;
  await bindCodeToPage(o.request, o.csrf, codeID, SLUG);
});
test.afterAll(async () => { await o.request.dispose(); });

test('§4 the page joins the assessment\'s clock; a forever page has none', async () => {
  const pages = (await tool<{ items: PageItem[] }>('microsite.list', {})).items;
  const page = pages.find((p) => p.slug === SLUG);
  expect(page?.retention).toBe('ephemeral');
  expect(page?.bundle_id, 'one clock').toBe(bundle);
});

test('§5 a recruiter opening the page with the code keeps the assessment alive', async ({ page }) => {
  backdate(60);
  const before = Date.parse((await rowOf(0)).last_touched_at!);
  await enterWithCode(page);
  await expect.poll(async () => Date.parse((await rowOf(0)).last_touched_at!) - before,
    { timeout: 20_000, message: 'the visit touched the bundle' }).toBeGreaterThan(59 * DAY);
});

test('§5 a pin on the page keeps the whole bundle past its time', async () => {
  await tool('retention.pin', { bundle_id: bundle, keep: true });
  backdate(120);
  const records = await clearedRecords(o);
  await sweep();
  expect(await clearedRecords(o), 'the sweep cleared nothing').toBe(records);
  expect((await pageStatus()).status, 'still served').not.toBe(410);
  expect((await rowOf(0)).reason, 'still assessed').toBe('ZEBRADEAL');
  await tool('retention.pin', { bundle_id: bundle, keep: false });
});

test('§4–5 at expiry the page says expired, the code is revoked as expired, all of it clears together', async () => {
  backdate(91);
  await sweep();
  await expect.poll(async () => (await pageStatus()).status, { timeout: 30_000 }).toBe(410);
  expect((await pageStatus()).body).toMatch(/expired/i);

  const codes = (await tool<{ items: { id: string; status: string; revoked_reason?: string }[] }>('codes.list', { limit: 200 })).items;
  const code = codes.find((c) => c.id === codeID);
  expect(code?.status).toBe('revoked');
  expect(code?.revoked_reason).toBe('expired');

  await expect.poll(async () => (await rowOf(0)).cleared_at, { timeout: 30_000 }).not.toBeNull();
  const trash = (await tool<{ items: { slug: string }[] }>('microsite.trash', {})).items;
  expect(trash.map((p) => p.slug), 'the page waits in the trash, restorable').toContain(SLUG);
});

test('§5 a commit makes the whole bundle forever', async () => {
  await jobsAnnotate(o, seenID(1), { reason: 'ZEBRASENT', retention: 'ephemeral' });
  const second = (await rowOf(1)).bundle_id!;
  await tool('microsite.create', { slug: 'sent-room', retention: 'ephemeral', bundle_id: second });
  await commitApplication(o, 1);
  expect((await rowOf(1)).retention).toBe('forever');
  const page = (await tool<{ items: PageItem[] }>('microsite.list', {})).items.find((p) => p.slug === 'sent-room');
  expect(page?.retention, 'its page too').toBe('forever');
  expect(page?.bundle_id).toBeNull();
});
