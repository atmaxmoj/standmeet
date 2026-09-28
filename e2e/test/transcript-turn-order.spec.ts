// transcript-turn-order.spec.ts — the owner's transcript reads question → its answer,
// turn after turn.
//
// Owner report (2026-09-28, a real interview on sijie.xyz): in the admin transcript some
// AI answers sat ABOVE the question they answered, so the conversation read out of turn.
//
// Mechanism (read from the code): one turn writes the visitor message and the assistant
// message in ONE transaction (conversation/repo/chats_dialog.go runAppendDialogQueries),
// and messages.created_at defaults to now() — the transaction's start time. The two rows
// carry the same timestamp, and the transcript query orders by created_at alone, so the
// tie comes back in whatever order the sort leaves it. Most turns look right; some flip.
//
// Confirmed on prod data (conversations.get, 2026-09-28): every visitor/assistant pair has
// the same created_at, and the same conversation comes back with a pair flipped in one
// read and not in another.
//
// On a fresh database the tie happens to come back in insertion order, because the rows
// sit in the table in the order they were written — which is why this passed on the old
// code at first. A live table does not stay that way: any UPDATE writes a new row version
// elsewhere in the table. The spec does what a live table does — touches the visitor rows
// once (no value changes) — and then asserts every one of 20 turns: each answer
// ("answer-NN") directly follows its own question ("question-NN"), in the order asked.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { scriptMockReplyText, sendAndDrain } from '@/fixtures/mock-llm-script';
import { gotoAdminSection } from '@/fixtures/navigate';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'turn-order@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'turnorder',
  fullName: 'Turn Order Owner',
};
const CODE = 'TURNORDER-001';
const VISITOR = 'Ordered Visitor';
const TURNS = 20;

const nn = (i: number): string => String(i).padStart(2, '0');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('transcript · every answer follows its own question', () => {
  test.beforeAll(async ({ playwright }) => {
    // 20 real turns through the agent loop (mock model) take longer than the 30s default.
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: CODE, label: 'turn order' });

    const session = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: VISITOR,
    });
    for (let i = 1; i <= TURNS; i++) {
      const tag = await scriptMockReplyText(request, `answer-${nn(i)}`);
      await sendAndDrain(request, session, `question-${nn(i)}${tag}`);
    }
    // A live table's rows move: rewrite the visitor rows once, values unchanged.
    execSQL(`UPDATE messages SET body = body WHERE role = 'visitor' AND body LIKE 'question-%'`);
    await request.dispose();
  });

  test(`${TURNS} turns read question → answer, in the order asked`, async ({ adminPage }) => {
    test.setTimeout(120_000);
    await gotoAdminSection(adminPage, 'conversations');
    await adminPage.getByText(VISITOR, { exact: true }).click();
    const modal = adminPage.getByTestId('transcript-body');
    await expect(modal, 'the last turn is in the transcript').toContainText(`answer-${nn(TURNS)}`, {
      timeout: 15_000,
    });

    // Each message is one list item: its label ("visitor" / "ai") then its body.
    const items = await modal.locator(':scope > ul > li').allTextContents();
    const got = items.map((text) => {
      const q = /question-(\d\d)/.exec(text);
      const a = /answer-(\d\d)/.exec(text);
      return q ? `Q${q[1]}` : a ? `A${a[1]}` : `?${text.slice(0, 20)}`;
    });
    const want = Array.from({ length: TURNS }, (_, k) => [`Q${nn(k + 1)}`, `A${nn(k + 1)}`]).flat();

    expect(got, 'each answer directly follows its own question; questions in asked order')
      .toEqual(want);
  });
});
