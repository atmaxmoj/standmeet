// application-withdraw-revokes.spec.ts —— roadmap 1.4.a/b: withdrawing an application takes its code
// back.
//
// "Done" (roadmap): after a withdraw, the recruiter's next turn is refused and a fresh scan of the QR
// gets nowhere; the public page still answers as the public tier.
//
// Contract (fixtures/application-loop.ts):
//   - the outcome lands first; a subscriber on application.outcome_changed (to=withdrawn) revokes the
//     code after (RevokeCode runs its own transaction) — so the refusal is polled, not read at once;
//   - update_outcome(withdrawn) answers with `bound: {embeds: [embed id], microsites: [slug]}`: what
//     else the code feeds, all of it cut off with the code.

import { test, expect } from '@/fixtures/test';

import {
  commitApplication, setupLoopOwner, updateOutcome, type Committed, type LoopOwner,
} from '@/fixtures/application-loop';
import { bindCodeToPage, publishPage } from '@/fixtures/microsite-rig';
import { createEmbedFor } from '@/fixtures/webhooks';
import { issueSession, issueSessionStatus, sendMessage, type VisitorSession } from '@/fixtures/visitor';

const HANDLE = 'appwithdraw';
const SLUG = 'apply-page';

let o: LoopOwner;
let app: Committed;
let embedID = '';
let recruiter: VisitorSession;

test.describe.configure({ mode: 'serial', timeout: 400_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, HANDLE);
  app = await commitApplication(o);
  await publishPage(o.request, o.csrf, SLUG);
  await bindCodeToPage(o.request, o.csrf, app.codeID, SLUG);
  embedID = (await createEmbedFor(o, app.codeID, 'withdraw-embed')).id;
  recruiter = await issueSession(o.request, { handle: o.handle, code: app.code, visitor_name: 'Recruiter' });
});
test.afterAll(async () => { await o.request.dispose(); });

test('withdraw cuts off the open session and the code, and names what the code fed', async () => {
  expect((await sendMessage(o.request, recruiter, 'hello')).status(), 'presence: the recruiter can talk').toBe(200);

  const out = await updateOutcome(o, app.applicationID, 'withdrawn', 'took another offer');
  expect(out.outcome).toBe('withdrawn');
  expect(out.bound?.microsites, 'the bound microsite is named').toContain(SLUG);
  expect(out.bound?.embeds, 'the bound embed is named').toContain(embedID);

  await expect.poll(async () => (await sendMessage(o.request, recruiter, 'still there?')).status(),
    { timeout: 30_000, message: 'the next turn on the open session is refused' }).toBe(401);
  const status = await issueSessionStatus(o.request, { handle: o.handle, code: app.code, visitor_name: 'Again' });
  expect(status, 'a fresh scan of the QR gets no session').toBeGreaterThanOrEqual(400);

  const pub = await issueSession(o.request, { handle: o.handle, mode: 'public', visitor_name: 'Stranger' });
  expect((await sendMessage(o.request, pub, 'hi')).status(), 'the public tier still answers').toBe(200);
});

test('an outcome other than withdrawn leaves the code alone and names nothing', async () => {
  const other = await commitApplication(o, 1);
  const sess = await issueSession(o.request, { handle: o.handle, code: other.code, visitor_name: 'R2' });
  const out = await updateOutcome(o, other.applicationID, 'interview');
  expect(out.bound, 'no bound list for a non-withdraw change').toBeUndefined();
  expect((await sendMessage(o.request, sess, 'hello')).status(), 'the code still works').toBe(200);
});
