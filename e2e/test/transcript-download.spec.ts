// transcript-download.spec.ts — the owner can take a transcript away as a file.
//
// Owner request (2026-09-28): "give the transcript a download button". Reading a long
// interview in a modal is fine; keeping it, quoting it or feeding it to another tool needs
// the text itself. The file is Markdown: who the visitor was, then every turn — question,
// answer — in the order it happened.

import { readFile } from 'node:fs/promises';

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { scriptMockReplyText, sendAndDrain } from '@/fixtures/mock-llm-script';
import { gotoAdminSection } from '@/fixtures/navigate';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'transcript-dl@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'transcriptdl',
  fullName: 'Transcript Download Owner',
};
const CODE = 'TRANSCRIPTDL-001';
const VISITOR = 'Download Visitor';
// Long enough that the transcript scrolls: the owner reads an interview to its end, and the
// download must still be there (2026-09-28: "still not easy to find" — it sat at the top of the
// scrolling body, in small grey type, and scrolled away).
const FILLER = 'A long answer that takes up room in the transcript, the way a real interview does. '.repeat(6);
const TURNS = [
  { q: 'What did you build first?', a: 'A Kafka ETL, from scratch.' },
  { q: 'And after that?', a: 'Delivery-platform integrations.' },
  ...Array.from({ length: 8 }, (_, i) => ({ q: `Follow-up question ${i + 1}?`, a: `Answer ${i + 1}. ${FILLER}` })),
];

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('transcript · download', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: CODE, label: 'download' });
    const session = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: VISITOR,
    });
    for (const turn of TURNS) {
      const tag = await scriptMockReplyText(request, turn.a);
      await sendAndDrain(request, session, `${turn.q}${tag}`);
    }
    await request.dispose();
  });

  test('the download is the whole conversation, in order', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'conversations');
    await adminPage.getByText(VISITOR, { exact: true }).click();
    const modal = adminPage.getByTestId('transcript-body');
    await expect(modal, 'the transcript has loaded').toContainText(TURNS[1]!.a, { timeout: 15_000 });

    const [download] = await Promise.all([
      adminPage.waitForEvent('download'),
      adminPage.getByTestId('transcript-download').click(),
    ]);
    expect(download.suggestedFilename(), 'a Markdown file').toMatch(/\.md$/);
    const text = await readFile(await download.path(), 'utf8');

    expect(text, 'names the visitor').toContain(VISITOR);
    const at = (s: string): number => text.indexOf(s);
    const order = TURNS.flatMap((t) => [t.q, t.a]);
    for (const s of order) expect(at(s), `contains "${s}"`).toBeGreaterThanOrEqual(0);
    expect(order.map(at), 'question → answer, turn after turn').toEqual([...order.map(at)].sort((x, y) => x - y));
  });

  test('the download stays in reach after reading to the end', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'conversations');
    await adminPage.getByText(VISITOR, { exact: true }).click();
    const last = adminPage.getByTestId('transcript-body').getByText(`Answer ${TURNS.length - 2}.`);
    await last.scrollIntoViewIfNeeded({ timeout: 15_000 });
    const button = adminPage.getByTestId('transcript-download');
    await expect(button, 'the button says what it does').toHaveAccessibleName(/download/i);
    await expect(button, 'still on screen at the end of a long transcript').toBeInViewport();
    // For a human to judge the header's look: an assertion cannot tell pinned from cramped.
    await adminPage.screenshot({ path: 'manual-runs/transcript-download-header.png' });
    await adminPage.setViewportSize({ width: 390, height: 800 });
    await expect(button, 'in reach on a phone too').toBeInViewport();
    await adminPage.screenshot({ path: 'manual-runs/transcript-download-header-mobile.png' });
  });
});
