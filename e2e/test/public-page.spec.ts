// public-page.spec.ts — the visitor's end-to-end user flow.
//
// User story:
//   A stranger opens the owner's public StandMeet page, reads the owner's hero prose,
//   sees the insights / projects / where / contact sections, then types a question
//   into the chat dock and hits Enter. A sessionless visitor **never gets an inline
//   answer** — they are always handed off to /gate (the question carried via ?q=; see
//   commit 485bf66 + page-shell.onAsk). After entering a code past the gate, back on
//   ChatRoom the carried question gets answered, and the reply's footer notes how many
//   corpus entries were cited.
//
// Zero page.goto in the e2e itself: claim + seed wiki + issue a code all happen via
// the API in beforeAll; the page fixture's automatic goto('/') then finds the instance
// already claimed → renders the public page (no redirect to /setup).

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const CODE = 'PUBLIC-1';
const QUESTION = 'tell me about alice';
// Explicit path so the migrated turn can register a corpus_read on it (a
// corpus_read is what records the citation the footnote asserts).
const INTRO_PATH = 'alice-intro';

test.describe("visitor reads owner's public page and chats with the persona", () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken());
    const { csrf } = await login(request);
    // The code used to pass the gate carries a role that can read the corpus
    // (wiki://**) → the answer can cite it and produce a footnote.
    const role = await createRole(request, csrf, {
      name: 'full', description: 'wiki://**', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, { code: CODE, label: 'public', assumed_role_id: role.id });
    const apiToken = await createAPIToken(request, csrf);
    const sid = await initMCP(request, apiToken);
    await seedWiki(request, apiToken, sid, {
      body: 'alice loves ASCII sparklines.',
      title: 'Alice intro',
      path: INTRO_PATH,
    });
    await request.dispose();
  });

  test('visitor sees full page, asks → hands off to /gate → over the gate the question is answered + cited',
    async ({ page }) => {
      await expectOwnerPageRendered(page);
      // Mock is pure registration: register the corpus_read whose result records
      // the citation the footnote asserts. The tag rides in the question, which
      // is carried through the /gate ?q= handoff and auto-asked over the gate —
      // so the read fires on that carried turn.
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: INTRO_PATH },
      });
      await visitorAsksAQuestion(page, `${QUESTION}${readTag}`);
      await expectHandoffToGate(page);
      await enterCodeAtGate(page, CODE);
      await expectCarriedQuestionAnswered(page);
      await expectCitationFootnote(page);
    });
});

async function expectOwnerPageRendered(page: Page): Promise<void> {
  // In the design, the owner's full name sits inside the identity strip (a mono caps
  // span, not a heading), so this uses getByText rather than getByRole('heading').
  await expect(page.getByText('Alice Anderson')).toBeVisible();
  // An empty section doesn't render at all (not even its heading) — corpus-pinning's
  // empty-state rule (docs/design/page-corpus-pinning.md): an unconfigured instance
  // shows only the name + chat box + examples.
  await expect(page.getByText("things I've been thinking about")).toHaveCount(0);
  await expect(page.getByText("what I'm building")).toHaveCount(0);
  await expect(page.getByText('where I am', { exact: true })).toHaveCount(0);
  // contact's default chat_line is genuine visitor-facing content (it points at a
  // real chat box that actually exists) → so the section stays.
  await expect(page.getByText('how to talk to me', { exact: true })).toBeVisible();
  // The hero example starter comes from defaultHeroExamples (a generic placeholder)
  await expect(page.getByText('What are you working on?')).toBeVisible();
  // F-A-21: the page is visitor-facing, so an UNCONFIGURED instance (this fresh claim, no page
  // config) must not show owner-onboarding copy to a visitor. The old default hero prose told the
  // reader to "Open /admin/page", and defaultWhere leaked "Edit your location in /admin/page." —
  // nonsensical/leaky to a visitor (esp. a coded one who can't reach /admin). Invariant (the class,
  // not one string): a visitor-facing surface never references /admin at all.
  await expect(page.getByText(/\/admin/)).toHaveCount(0);
  await expect(page.getByText('This is your StandMeet page')).toHaveCount(0);
  // Same class, frontend side: an unconfigured contact must not render the dangling
  // "Or directly:" label (empty mailto) — empty fields render nothing, not scaffolding.
  await expect(page.getByText('Or directly:')).toHaveCount(0);
}

async function visitorAsksAQuestion(page: Page, question: string): Promise<void> {
  // The new AskInput is input[type=text], not a textarea; the form submits on Enter.
  // **The homepage's box has its own name** (F-Q-3): its behavior differs from the
  // one in an active session (with no session, Enter means "hand off to /gate"), and
  // when the two shared a testid, nobody could tell which one they were actually
  // typing into — that confusion once fooled two separate real-environment driving
  // sessions.
  const input = page.locator('[data-testid="home-ask-field"]');
  await input.fill(question);
  await input.press('Enter');
}

// expectHandoffToGate — a sessionless question gets no inline answer: it lands on
// /gate, the question carried via ?q=.
async function expectHandoffToGate(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/gate\?.*q=/, { timeout: 5_000 });
}

// enterCodeAtGate — fills in a code at /gate to join a session; once past the gate,
// ?q= carries back to / and the answer continues.
async function enterCodeAtGate(page: Page, code: string): Promise<void> {
  await page.getByTestId('gate-code').fill(code);
  await page.getByTestId('gate-visitor-name').fill('Sarah (Acme HR)');
  await page.getByTestId('gate-code-submit').click();
}

async function expectCarriedQuestionAnswered(page: Page): Promise<void> {
  // ConversationDeck hangs the reply off data-testid="answer-body". The carried
  // question is auto-asked by ChatRoom (not lost) → the streamed reply lands in
  // answer-body.
  await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="answer-body"]'))
    .toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(QUESTION)).toBeVisible();
}

async function expectCitationFootnote(page: Page): Promise<void> {
  // The citation block now behaves like an ordinary AI chat: it collapses by default
  // into a single "references · N" line (click to expand the list).
  const cited = page.locator('[data-testid="citations"]');
  await expect(cited).toBeVisible({ timeout: 5_000 });
  await expect(cited).toContainText('references');
}
