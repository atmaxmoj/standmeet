// microsite-agent-reads-page.spec.ts —— the agent in a microsite's chat knows what the page it sits
// on says.
//
// Before: the turn carried only the page title (doc_context.title, from og:title / document.title),
// so "what does this page mean by X?" could only be guessed from the title. Text the owner wrote in
// the page's own source — not in the corpus — never reached the model.
//
// Contract (red on the unchanged code):
//   • The served microsite says which microsite it is (a server-injected meta), and the SDK sends
//     doc_context {genre: "microsite", path: <slug>}.
//   • The backend puts that microsite's live, prerendered text into the turn's instruction. The
//     text comes from the owner's published build on the server, never from the browser.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { openReader } from '@/fixtures/navigate';
import { gatewayRequestExists, resetGatewayRequests, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { publishPage } from '@/fixtures/microsite-rig';

const OWNER = {
  email: 'pageaware@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'pageaware',
  fullName: 'Page Aware Owner',
};
const SLUG = 'page-aware';
// Only in this page's source: not a corpus entry, not the title.
const PAGE_FACT = 'The lighthouse keeper counts ninety-seven steps every morning.';

const SOURCE = `
import { useState } from "react";
import { StandMeetProvider, useChatSession } from "@standmeet/sdk";

function Ask() {
  const chat = useChatSession({ mode: "public", visitor_name: "reader" });
  const [draft, setDraft] = useState("");
  const answer = [...chat.messages].reverse().find((m) => m.role === "assistant");
  return (
    <div>
      <input data-sm="ask" value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { const t = draft; setDraft(""); void chat.send(t); } }} />
      <div data-sm="answer">{answer ? answer.text : ""}</div>
    </div>
  );
}

export default function App() {
  return (
    <StandMeetProvider>
      <main>
        <h1>Lighthouse notes</h1>
        <p>${PAGE_FACT}</p>
        <Ask />
      </main>
    </StandMeetProvider>
  );
}
`;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ timeout: 300_000 });
test.describe('microsite · the chat on a page reads the page', () => {
  test('a question asked on the page reaches the model with the page\'s own text',
    async ({ playwright, browser }) => {
      resetInstance();
      const request = await playwright.request.newContext();
      await claim(request, findSetupToken(), OWNER);
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      await publishPage(request, csrf, SLUG, SOURCE);
      await resetGatewayRequests(request);
      const tag = await scriptMockReplyText(request, 'Ninety-seven.');

      const reader = await (await browser.newContext()).newPage();
      await openReader(reader, `/p/${SLUG}`);
      const box = reader.locator('[data-sm="ask"]');
      await box.waitFor({ state: 'visible', timeout: 20_000 });
      await box.fill(`how many steps does the keeper count? ${tag}`);
      await box.press('Enter');
      await expect(reader.locator('[data-sm="answer"]')).toContainText('Ninety-seven', { timeout: 30_000 });

      expect(await gatewayRequestExists(request, PAGE_FACT),
        'the page\'s own text reached the model').toBe(true);
      await reader.context().close();
      await request.dispose();
    });
});
