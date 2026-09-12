// microsite-editor-live-follow.spec.ts — the GUI editor follows live: the owner edits the source
// and the preview updates ON ITS OWN — no "build preview" click, no reload.
//
// The owner's complaint (2026-09-06): "didn't we have a real-time build? why is it click-to-build
// now?" The agent path already follows live (microsite-preview-follows-the-agent), but that drives
// the change through MCP. This is the same live-follow when the change is made IN THE GUI EDITOR:
// type, and the render on the right catches up on its own.
//
// Behavior, not mechanism: this never waits on /microsites/wait or any build endpoint, and never
// clicks a build button or reloads. It types, and asserts the preview shows it. How the update
// arrives (debounced auto-build + long-poll, today) is not the test's business — only that it does.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'livefollow@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'livefollow',
  fullName: 'Live Follow Owner',
};
const SLUG = 'press-kit';

// appWith — a page whose headline is a unique per-version marker, so "it changed" asserts on
// something that belongs only to this version (not a shape two versions share).
function appWith(marker: string): string {
  return `export default function App() {\n  return <main><h1 data-sm="headline">${marker}</h1></main>;\n}`;
}

// headlineIn — the headline inside the editor's live preview iframe (the right pane).
function headlineIn(page: Page) {
  return page.frameLocator('[data-testid="microsite-staging-frame"]').locator('[data-sm="headline"]');
}

// editSource — type a whole new source into the CodeMirror surface. fill() pastes in one shot so
// bracket-closing doesn't corrupt the JSX. This is the ONLY action — no build click follows it.
async function editSource(page: Page, source: string): Promise<void> {
  const body = page.getByTestId('microsite-source').locator('.cm-content');
  await body.click();
  await body.fill(source);
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
// Each edit triggers a real sandbox build (tens of seconds), and this case edits twice.
test.describe.configure({ timeout: 600_000 });
// pollBuildID —— the build id the panel currently believes in, once it has moved off `prev`.
// Returns whatever it holds when the window closes, so the caller asserts the VALUE rather than
// the absence of a change.
async function pollBuildID(page: Page, prev: string): Promise<string> {
  let seen = prev;
  await expect.poll(async () => {
    seen = (await page.getByTestId('microsite-staging-state').getAttribute('data-build-id')) ?? '';
    return seen !== prev && seen !== '';
  }, { timeout: 120_000, intervals: [1000] }).toBe(true);
  return seen;
}

test.describe('microsites · the GUI editor follows live as the owner types', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'livefollow-spec');
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'microsite.create', { slug: SLUG, title: 'Press kit' });
    await callTool(request, token, sid, 'microsite.write_file', {
      slug: SLUG, path: 'App.tsx', content: appWith('INITIAL'),
    });
    await request.dispose();
  });

  test('editing the source updates the preview live — no build click, no reload',
    async ({ adminPage: page }) => {
      await openReader(page, `/admin/edit/${SLUG}`);

      // First edit: type a new headline and DON'T click build. The preview must catch up on its own.
      // RED before auto-build-on-edit: the preview never changes until "build preview" is clicked.
      // Pin the STARTING state first. The panel renders PreviewEmpty until the open-time build
      // lands, so reading the baseline straight after navigating reads an element that does not
      // exist yet — and the test's own setup wrote INITIAL, so this is the state it means to
      // start from rather than one it assumes.
      await expect(headlineIn(page), 'the open-time build lands and shows the seeded source')
        .toHaveText('INITIAL', { timeout: 300_000 });
      const before = await page.getByTestId('microsite-staging-state')
        .getAttribute('data-build-id');
      await editSource(page, appWith('LIVE-EDIT-ONE'));

      // Which half? — the panel must first LEARN of a new build. A preview that never moves looks
      // the same whether the client never heard about the rebuild or heard and rendered the old
      // one; data-build-id is the only thing that separates them.
      // Positive, not `.not.toHaveAttribute`: a negated form passes when the element is simply
      // gone ([[dont-write-absence-tests]]). Poll the VALUE, then assert it is a real id and a
      // different one.
      const after = await pollBuildID(page, before ?? '');
      expect(after, 'the panel learned of a new build (the follow chain delivered it)')
        .toMatch(/^[0-9a-f-]{36}$/);
      expect(after, 'and it is a different build than before the edit').not.toBe(before);

      await expect(headlineIn(page), 'the preview follows the first edit with no build click')
        .toHaveText('LIVE-EDIT-ONE', { timeout: 300_000 });

      // Second edit, still no build click and no reload: it keeps following. Two edits, because the
      // owner's complaint is precisely "I have to trigger it myself every time".
      await editSource(page, appWith('LIVE-EDIT-TWO'));
      await expect(headlineIn(page), 'the preview keeps following further edits, still hands-off')
        .toHaveText('LIVE-EDIT-TWO', { timeout: 300_000 });
    });
});
