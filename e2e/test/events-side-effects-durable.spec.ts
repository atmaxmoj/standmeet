// events-side-effects-durable.spec.ts —— Phase 4 of docs/design/event-bus-outbox-webhooks.md:
// side effects that used to be sent inline (or from a detached goroutine) now travel as durable
// jobs off the bus, so a failed send is retried and a restart loses nothing.
//
// Contract (red on the unchanged code):
//   • An access request whose owner notification fails once still notifies the owner (retried).
//   • Approving a request with the mail relay failing once: the request shows sending → sent,
//     and it is marked replied only once the mail has actually gone. Admin's request row (request-row-<id>) carries
//     data-testid="request-mail-state" with data-state = sending | sent | failed.
//   • A booking made while the backend restarts still notifies the owner.
//   • jobs.fetch_new past its wait returns a receipt ({job_id}); tasks.get on it returns the same
//     listings shape once done.

import type { APIRequestContext } from '@playwright/test';

import { test, expect } from '@/fixtures/test';
import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance, restartBackend } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import {
  armSMTPFault, clearMailpit, configureMailSupplier, resetSMTPFault, waitForMailEnvelopeTo,
  waitForMailToContaining,
} from '@/fixtures/mail';
import { gotoAdminSection } from '@/fixtures/navigate';
import { BACKEND } from '@/fixtures/stack';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import {
  OWNER as BOOKING_OWNER, seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { bookAsVisitor } from '@/fixtures/visitor-booking';

const OWNER = {
  email: 'durable@example.com', password: 'correct-horse-battery-staple',
  handle: 'durable', fullName: 'Durable Owner',
};

let request: APIRequestContext;
let token = '';
let sid = '';

async function submitRequest(email: string, ip: string): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/access-requests`, {
    headers: { 'X-Forwarded-For': ip },
    data: { handle: OWNER.handle, name: 'Durable Visitor', org: 'Lab', email, message: 'May I have access please?' },
  });
  return res.status();
}

async function requestID(email: string): Promise<string> {
  const reqs = await callTool<{ id: string; email: string }[]>(request, token, sid, 'access_requests.list', {});
  return reqs.find((r) => r.email === email)?.id ?? '';
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('P4 · side effects are durable jobs', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await configureMailSupplier(request, OWNER.email, OWNER.password);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    token = await createAPIToken(request, csrf, 'durable');
    sid = await initMCP(request, token);
  });
  test.afterAll(async () => {
    await resetSMTPFault(request);
    await request.dispose();
  });

  test('an access-request notification that fails once still reaches the owner', async () => {
    await clearMailpit(request);
    await armSMTPFault(request, { mode: 'transient', times: 1 });
    expect(await submitRequest('retry-visitor@example.com', '198.51.100.21')).toBe(201);
    await waitForMailToContaining(request, OWNER.email, 'retry-visitor@example.com', 60_000);
  });

  test('approval: sending → sent, and replied only after the mail has gone', async ({ adminPage }) => {
    const visitor = 'approve-visitor@example.com';
    expect(await submitRequest(visitor, '198.51.100.22')).toBe(201);
    const id = await requestID(visitor);
    await clearMailpit(request);
    await armSMTPFault(request, { mode: 'transient', times: 1 });
    const res = await callTool<{ code?: string; mail?: { state: string; job_id?: number } }>(
      request, token, sid, 'access_requests.approve', { id },
    );
    expect(res.code, 'the code is issued at once').toBeTruthy();
    expect(['sending', 'sent']).toContain(res.mail?.state);

    await gotoAdminSection(adminPage, 'requests');
    // A replied request leaves the default 'open' filter; look in 'all'.
    await adminPage.getByTestId('requests-filters').getByText('all', { exact: true }).click();
    const row = adminPage.getByTestId(`request-row-${id}`);
    await expect(row.getByTestId('request-mail-state')).toHaveAttribute('data-state', 'sent', { timeout: 60_000 });
    await waitForMailEnvelopeTo(request, visitor, 30_000);
    const after = await callTool<{ id: string; status: string }[]>(request, token, sid, 'access_requests.list', {});
    expect(after.find((r) => r.id === id)?.status).toBe('replied');
  });

  test('approval with a permanently failing relay shows failed and is not marked replied', async ({ adminPage }) => {
    const visitor = 'bounce-visitor@example.com';
    expect(await submitRequest(visitor, '198.51.100.23')).toBe(201);
    const id = await requestID(visitor);
    await armSMTPFault(request, { mode: 'permanent' });
    await callTool(request, token, sid, 'access_requests.approve', { id });
    await gotoAdminSection(adminPage, 'requests');
    // A replied request leaves the default 'open' filter; look in 'all'.
    await adminPage.getByTestId('requests-filters').getByText('all', { exact: true }).click();
    const row = adminPage.getByTestId(`request-row-${id}`);
    await expect(row.getByTestId('request-mail-state')).toHaveAttribute('data-state', 'failed', { timeout: 60_000 });
    const after = await callTool<{ id: string; status: string }[]>(request, token, sid, 'access_requests.list', {});
    expect(after.find((r) => r.id === id)?.status).not.toBe('replied');
    await resetSMTPFault(request);
  });

  test('a notification queued just before a backend restart is still delivered after it', async () => {
    await resetSMTPFault(request);
    await clearMailpit(request);
    await armSMTPFault(request, { mode: 'connection_refused' }); // hold it in the queue
    expect(await submitRequest('restart-visitor@example.com', '198.51.100.24')).toBe(201);
    restartBackend();
    await resetSMTPFault(request);
    await waitForMailToContaining(request, OWNER.email, 'restart-visitor@example.com', 120_000);
  });
});

// The booker used to hand the owner's booking notice to a detached goroutine: a restart while it
// retried lost the mail. Now booking.created is recorded before the booking answers, and the
// owner.notify job survives the restart.
test.describe('P4 · a booking notifies the owner across a restart', () => {
  test.describe.configure({ timeout: 240_000 });
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, { granted_skills: ['calendar.book'] });
    await configureMailSupplier(seed.request, BOOKING_OWNER.email, BOOKING_OWNER.password);
    // configureMailSupplier logs in again, rotating the CSRF token.
    seed.csrf = (await loginAPI(seed.request, BOOKING_OWNER.email, BOOKING_OWNER.password)).csrf;
  });
  test.afterAll(async () => {
    await resetSMTPFault(seed.request);
    await teardownSeed(seed);
  });

  test('a booking made while the backend restarts still notifies the owner', async ({ browser }) => {
    await clearMailpit(seed.request);
    const code = await issueCodeWithSkills(seed.request, seed.csrf, {
      granted_skills: ['calendar.book'], notify_owner: true,
    });
    await armSMTPFault(seed.request, { mode: 'connection_refused' }); // hold the notice in the queue
    const topic = 'Restart-proof intro call';
    const page = await bookAsVisitor(browser, { code: code.code, name: 'Rita', topic, hour: 13 });
    await page.context().close();
    restartBackend();
    await resetSMTPFault(seed.request);
    const mail = await waitForMailEnvelopeTo(seed.request, BOOKING_OWNER.email, 120_000);
    expect(mail.text).toContain(topic);
    expect(mail.text).toContain('Rita');
  });
});
