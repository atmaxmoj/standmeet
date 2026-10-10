// application-engaged-notify.spec.ts —— roadmap E1 · story 1.2 "recruiter 第一次来聊，IM 通知我".
//
// Done when: one notify rule pushes ONE readable card per application; the event bus delivering
// twice still reaches a webhook once.
//
// Contract (beyond fixtures/application-loop.ts):
//   • application.engaged is recorded once per application, on the first conversation on its code;
//     data is exactly {application_id, code_id, conversation_id} (that first conversation).
//   • a conversation with no code records nothing.
//   • a notify rule on application.engaged renders {company} and {role} from the application.
// The email channel stands for every notify channel (cards render one way, subscriber/notify.go).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { commitApplication, setupLoopOwner, type Committed, type LoopOwner } from '@/fixtures/application-loop';
import { clearMailpit, configureMailSupplier, waitForMailToContaining } from '@/fixtures/mail';
import { callTool } from '@/fixtures/mcp';
import { issueSession, sendMessage, type VisitorSession } from '@/fixtures/visitor';
import { accepted, createHook, received, resetSink, type SinkDelivery } from '@/fixtures/webhooks';

const HANDLE = 'appengaged';
const PASSWORD = 'correct-horse-battery-staple';
const SINK = 'app-engaged';
const CARD = 'ENGAGEDCARD';

let o: LoopOwner;
let app: Committed;
let visitor: APIRequestContext;
let firstConv = '';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, HANDLE);
  visitor = await playwright.request.newContext();
  await resetSink(o.request);
  await clearMailpit(o.request);
  await createHook(o, SINK, ['application.engaged', 'conversation.started']);
  const mailCtx = await playwright.request.newContext();
  await configureMailSupplier(mailCtx, o.email, PASSWORD);
  await mailCtx.dispose();
  await callTool(o.request, o.apiToken, o.sid, 'notify.create_rule', {
    event_type: 'application.engaged', channel: 'email', template: `${CARD} {company} · {role} · {code}`,
  });
  app = await commitApplication(o, 0);
});

test.afterAll(async () => {
  await visitor.dispose();
  await o.request.dispose();
});

async function deliveries(type: string): Promise<SinkDelivery[]> {
  return accepted(await received(o.request, SINK)).filter((d) => d.body.type === type);
}

async function chatOnce(sess: VisitorSession, q: string): Promise<void> {
  expect((await sendMessage(visitor, sess, q)).status(), `the turn "${q}" ran`).toBe(200);
}

async function startedDelivered(conversationID: string): Promise<void> {
  await expect.poll(async () => (await deliveries('conversation.started'))
    .some((d) => d.body.subject.endsWith(conversationID)),
  { timeout: 60_000, intervals: [500], message: `conversation.started for ${conversationID}` }).toBe(true);
}

test('1.2.a/b — the first conversation on the code records application.engaged, exactly once', async () => {
  const pub = await issueSession(visitor, { handle: o.handle, mode: 'public', visitor_name: 'Stranger' });
  await chatOnce(pub, 'Hello, who are you?');
  await startedDelivered(pub.conversation_id);

  const a = await issueSession(visitor, { handle: o.handle, mode: 'code', code: app.code, visitor_name: 'Recruiter' });
  firstConv = a.conversation_id;
  await chatOnce(a, 'What did you build last year?');
  await expect.poll(async () => (await deliveries('application.engaged')).length,
    { timeout: 60_000, intervals: [500], message: 'the first conversation engages the application' }).toBe(1);
  const engaged = (await deliveries('application.engaged'))[0]!;
  expect(engaged.body.data, 'thin: ids only').toEqual({
    application_id: app.applicationID, code_id: app.codeID, conversation_id: firstConv,
  });
  expect(engaged.body.subject).toBe(`application/${app.applicationID}`);

  const b = await issueSession(visitor, { handle: o.handle, mode: 'code', code: app.code, visitor_name: 'Recruiter again' });
  await chatOnce(b, 'One more question.');
  await startedDelivered(b.conversation_id); // presence: the second conversation's events did flow
  expect(await deliveries('application.engaged'), 'a second conversation does not engage again').toHaveLength(1);
  expect((await deliveries('application.engaged')).some((d) => d.body.data['conversation_id'] === pub.conversation_id),
    'a codeless conversation engages nothing').toBe(false);
});

test('1.2.c — the notify card names the company and the role', async () => {
  const mail = await waitForMailToContaining(o.request, o.email, CARD, 60_000);
  expect(mail.text, 'company').toContain(app.job.company);
  expect(mail.text, 'role').toContain(app.job.title);
});
