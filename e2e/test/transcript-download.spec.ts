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
const TURNS = [
  { q: 'What did you build first?', a: 'A Kafka ETL, from scratch.' },
  { q: 'And after that?', a: 'Delivery-platform integrations.' },
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
});
