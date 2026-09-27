// webhook-event-types.spec.ts —— every webhook event type of docs/design/event-bus-outbox-webhooks.md
// (*Consolidation inventory › Webhook event types*) reaches a receiver when its real action happens.
//
// One owner, ONE endpoint subscribed to "*" pointing at the sink. Each row performs the action the
// way the product is driven — the owner MCP face, the admin fixtures the panel's calls live in, or
// the public/visitor API — and asserts the sink got that type with the expected subject. The rows
// run in order and share state (a visitor session, a code, a page): they are one owner's afternoon.
//
// Not a row, and why:
//   • instance.upgrade_requested — recorded only when the updater sidecar is present (the pulse can
//     go out); the e2e stack runs no updater, so pressing upgrade is refused and records nothing.
//
// Already covered elsewhere, so not repeated: corpus.note.changed and webhook.test (webhooks.spec),
// microsite.build.settled (events-build-settled.spec), booking.* (booking-owner-notify.spec),
// jobs.fetched (jobs specs).

import type { APIRequestContext } from '@playwright/test';

import { test, expect } from '@/fixtures/test';
import { login } from '@/fixtures/admin';
import { changeAccountEmail, requestRecovery } from '@/fixtures/admin-mutations';
import { createCode } from '@/fixtures/codes';
import { insertPageDoc, showAndAcceptGhost, submitAccessRequest } from '@/fixtures/event-actions';
import { execSQL, querySQL } from '@/fixtures/instance';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { configureMailSupplier } from '@/fixtures/mail';
import { callTool } from '@/fixtures/mcp';
import { publishPage } from '@/fixtures/microsite-rig';
import { createProvider, setProviderGas } from '@/fixtures/providers';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';
import { setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { createRole } from '@/fixtures/roles';
import { issueSession, sendMessage, type VisitorSession } from '@/fixtures/visitor';
import { accepted, createHook, received, resetSink } from '@/fixtures/webhooks';

const SINK = 'types';
const PASSWORD = 'correct-horse-battery-staple';
const GATEWAY = 'http://llm-gateway:9300';
const PAGE = 'evt-page';
const BROKEN_ID = 'acme.broken.zzfixture';
const BROKEN_MANIFEST = `id: ${BROKEN_ID}
title: Acme Broken
version: "1"
shape: visitor_only
acl: role_granted
visitor_tools:
  - acme_broken_thing
transport:
  kind: stdio
  command: /nonexistent/acme-broken-server
`;

let O: RetrievalOwner;
let visitor: APIRequestContext;
let csrf = '';
// What earlier rows made and later rows act on.
const S = { requestID: '', codeID: '', code: '', keyID: '', writingID: '', providerID: '', ownerID: '' };
let sess: VisitorSession;

async function mcp<T>(tool: string, args: Record<string, unknown>): Promise<T> {
  return callTool<T>(O.request, O.apiToken, O.sid, tool, args);
}

async function relogin(): Promise<void> {
  ({ csrf } = await login(O.request, O.email, PASSWORD));
}

interface Row {
  type: string;
  subject: () => string; // the subject the delivery must start with
  act: () => Promise<void>;
  timeout?: number;
}

// ── actions that take more than one line ──

async function openVisitor(name: string): Promise<VisitorSession> {
  return issueSession(visitor, { handle: O.handle, mode: 'code', code: S.code, visitor_name: name });
}

async function runDry(): Promise<void> {
  await setProviderGas(O.request, csrf, S.providerID, 0);
  const role = await createRole(O.request, csrf, {
    name: 'evt-metered', description: 'gauge on', corpus_uris: ['wiki://**'],
    provider_id: S.providerID, gas_metered: true,
  });
  await createCode(O.request, csrf, { code: 'EVT-GAS', label: 'gas', assumed_role_id: role.id });
  const dry = await issueSession(visitor, { handle: O.handle, code: 'EVT-GAS', visitor_name: 'G' });
  expect((await sendMessage(visitor, dry, 'anything')).status(), 'the dry tank refuses').toBe(403);
}

async function failBlock(): Promise<void> {
  await mcp('bundles.create', { name: 'evt-broken', blocks: ['corpus.retrieval', BROKEN_ID] });
  const code = await mcp<{ code: string }>('codes.create', { label: 'broken', bundle: 'evt-broken' });
  await issueSession(visitor, { handle: O.handle, mode: 'code', code: code.code });
}

async function commitApplication(): Promise<void> {
  const source = await jobsRegisterSource(O.request, O.apiToken, O.sid, {
    kind: 'greenhouse', label: 'Anthropic', config: { company: 'anthropic' },
  });
  const first = (await jobsFetchNew(O.request, O.apiToken, O.sid, source.id)).jobs[0];
  expect(first, 'the mock board has a job to apply to').toBeDefined();
  const drafted = await resumeDraft(O.request, O.apiToken, O.sid, first!.cache_id, sampleResumeContent());
  await applicationsCommit(O.request, O.apiToken, O.sid, drafted.view.draft_id);
}

async function rollBack(): Promise<void> {
  const pages = await mcp<{ slug: string; live_build_id?: string }[]>('microsite.list', {});
  const build = pages.find((p) => p.slug === PAGE)?.live_build_id ?? '';
  await mcp('microsite.promote_to_live', { slug: PAGE, build_id: build }); // leaves a previous
  await mcp('microsite.rollback', { slug: PAGE });
}

async function pruneOldConversation(): Promise<void> {
  execSQL(`INSERT INTO conversations (owner_id, mode, visitor_name, started_at, last_at) VALUES
    ('${S.ownerID}', 'public', 'old', now() - interval '3 days', now() - interval '3 days')`);
  await mcp('conversations.public_policy_set', { save: true, prune_cron: '* * * * *', retention_days: 1 });
}

// ── the table ──

const ownerSubject = () => `owner/${S.ownerID}`;
const mail = () => 'supplier/smtp';

const ROWS: Row[] = [
  { type: 'owner.login', subject: ownerSubject, act: relogin },
  { type: 'access_request.created', subject: () => 'access_request/', act: async () => {
    await submitAccessRequest(visitor, 'eve@example.com', '198.51.100.23');
    S.requestID = (await mcp<{ items: { id: string }[] }>('access_requests.list', {})).items[0]?.id ?? '';
  } },
  { type: 'access_request.status_changed', subject: () => `access_request/${S.requestID}`,
    act: async () => { await mcp('access_requests.update', { id: S.requestID, status: 'closed' }); } },
  { type: 'supplier.connected', subject: mail, act: async () => {
    await configureMailSupplier(O.request, O.email, PASSWORD);
    await relogin();
  } },
  { type: 'supplier.activated', subject: mail,
    act: async () => { await mcp('suppliers.activate', { id: 'smtp' }); } },
  { type: 'access_request.approved', subject: () => `access_request/${S.requestID}`,
    act: async () => { await mcp('access_requests.approve', { id: S.requestID }); } },
  { type: 'code.issued', subject: () => `code/${S.codeID}`, act: async () => {
    ({ id: S.codeID, code: S.code } = await mcp<{ id: string; code: string }>('codes.create', { label: 'evt' }));
  } },
  { type: 'code.redeemed', subject: () => `code/${S.codeID}`, act: async () => { await openVisitor('Ann'); } },
  { type: 'conversation.started', subject: () => `conversation/${sess.conversation_id}`,
    act: async () => { sess = await openVisitor('Ben'); } },
  { type: 'conversation.message', subject: () => `conversation/${sess.conversation_id}`,
    act: async () => { expect((await sendMessage(visitor, sess, 'hello there')).status()).toBe(200); } },
  { type: 'ghost.accepted', subject: () => 'ghost/', act: () => showAndAcceptGhost(visitor, sess) },
  { type: 'code.revoked', subject: () => `code/${S.codeID}`,
    act: async () => { await mcp('codes.revoke', { code_id: S.codeID }); } },
  { type: 'writing.published', subject: () => `writing/${S.writingID}`, act: async () => {
    S.writingID = (await mcp<{ id: string }>('writing_create', { slug: 'evt-writing', title: 'Evt' })).id;
    await mcp('writings.publish', { writing_id: S.writingID });
  } },
  { type: 'writing.unpublished', subject: () => `writing/${S.writingID}`,
    act: async () => { await mcp('writings.unpublish', { writing_id: S.writingID }); } },
  { type: 'vault.imported', subject: () => `vault/${S.ownerID}`, act: async () => {
    await mcp('obsidian.import', { files: [{ path: 'wiki/evt-vault.md', content: '# Evt vault\n\nbody' }] });
  } },
  { type: 'api_key.issued', subject: () => `api_key/${S.keyID}`, act: async () => {
    const role = await createRole(O.request, csrf, { name: 'evt-api', description: 'api', corpus_uris: [] });
    S.keyID = (await mcp<{ id: string }>('api_keys.create', { label: 'evt', assumed_role_id: role.id })).id;
  } },
  { type: 'api_key.revoked', subject: () => `api_key/${S.keyID}`,
    act: async () => { await mcp('api_keys.revoke', { id: S.keyID }); } },
  { type: 'ip_ban.added', subject: () => 'ip_ban/',
    act: async () => { await mcp('ip_bans.add', { ip: '203.0.113.7' }); } },
  { type: 'gas.refilled', subject: () => `provider/${S.providerID}`, act: async () => {
    S.providerID = (await createProvider(O.request, csrf, {
      label: 'evt-tank', provider: 'anthropic', endpoint: GATEWAY, model: 'mock-model-gas', key: 'sk-gas-00000000000',
    })).id;
    await setProviderGas(O.request, csrf, S.providerID, 100_000);
  } },
  { type: 'gas.exhausted', subject: () => `provider/${S.providerID}`, act: runDry },
  { type: 'owner.recovery_requested', subject: ownerSubject, act: async () => { await requestRecovery(O.request, csrf); } },
  { type: 'block.installed', subject: () => `block/${BROKEN_ID}`,
    act: async () => { await mcp('blocks.install', { manifest: BROKEN_MANIFEST }); } },
  { type: 'block.failed', subject: () => `block/${BROKEN_ID}`, act: failBlock },
  { type: 'application.committed', subject: () => 'application/', act: commitApplication, timeout: 180_000 },
  { type: 'page.promoted_live', subject: () => `microsite/${PAGE}`,
    act: () => publishPage(O.request, csrf, PAGE), timeout: 300_000 },
  { type: 'page.rolled_back', subject: () => `microsite/${PAGE}`, act: rollBack },
  { type: 'microsite.store.doc_inserted', subject: () => `microsite/${PAGE}`, act: async () => {
    await mcp('microsite.set_store_writable', { slug: PAGE, store_writable: true });
    await insertPageDoc(visitor, PAGE, 'notes', { n: 1 });
  } },
  { type: 'page.unpublished', subject: () => `microsite/${PAGE}`,
    act: async () => { await mcp('microsite.unpublish', { slug: PAGE }); } },
  { type: 'supplier.disconnected', subject: mail,
    act: async () => { await mcp('suppliers.disconnect', { id: 'smtp' }); } },
  // With no mail supplier the change applies at once (no confirmation mail to click).
  { type: 'owner.email_changed', subject: ownerSubject, act: async () => {
    await changeAccountEmail(O.request, csrf, { current_password: PASSWORD, new_email: 'evt-moved@example.com' });
  } },
  // The prune sweep runs every 5 minutes; the row waits for its next pass.
  { type: 'conversation.pruned', subject: ownerSubject, act: pruneOldConversation, timeout: 420_000 },
];

async function delivered(type: string, subject: string, timeout: number): Promise<void> {
  await expect.poll(async () => accepted(await received(O.request, SINK))
    .some((d) => d.body.type === type && d.body.subject.startsWith(subject)),
  { timeout, intervals: [500], message: `${type} with subject ${subject}… reached the receiver` }).toBe(true);
}

test.describe('webhook event types · each real action reaches a "*" endpoint', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'evtypes');
    csrf = O.csrf;
    visitor = await playwright.request.newContext();
    S.ownerID = querySQL('SELECT id FROM owners LIMIT 1');
    await resetSink(O.request);
    await createHook(O, SINK, ['*']);
  });
  test.afterAll(async () => {
    await visitor.dispose();
    await O.request.dispose();
  });

  for (const row of ROWS) {
    test(row.type, async () => {
      const budget = row.timeout ?? 90_000;
      test.setTimeout(budget + 30_000);
      await row.act();
      await delivered(row.type, row.subject(), budget);
    });
  }
});
