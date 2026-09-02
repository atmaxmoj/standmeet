// mobile-sweep.spec.ts -- takes **one screenshot of every surface** at a mobile
// viewport, for a human to review.
//
// This suite is not a functional test; it makes zero business assertions. It exists
// because a broken responsive layout is **invisible to assertions**: admin at 390px has
// `scrollWidth === clientWidth`, nothing exceeds the viewport width, and every existing
// e2e assertion stays green -- while the sidebar eats 463 out of a 390px viewport, the
// body is squeezed down to 158px, the heading gets clipped to "dashboar", and the stat
// cards fit one or two characters per line. Nothing overflows; everything is **crushed**,
// and crushing is exactly the failure mode ([[text-assertion-cannot-see-layout]]). So
// the output here is images, and the criterion lives with whoever looks at them.
//
// **The list of surfaces is always read, never hand-typed.** The first version applied
// this rule to admin (read from the sidebar nav, catching all 26 sections), but
// hand-typed four lines for the public surfaces -- so the whole public reading surface
// (/wiki, /writings, article pages) got zero screenshots, and long-form typesetting is
// exactly where mobile gets tightest. I wrote the same lesson down in my own comments
// and broke it one screen later ([[lesson-not-swept-to-neighbours]]). Both sides are
// now read:
//   - public routes <- Next's app router directory (the product adds a page, this suite
//     picks it up automatically)
//   - admin sections <- the product's own sidebar
//   - individual articles <- clicked through from the product's own index page (never
//     guessing a slug)
//
// Run: `make mobile-shots` (everything) / `GREP=owner` drives just the admin group.
// Images land in e2e/manual-runs/mobile-sweep/, overwriting same-named files -- re-run
// after a change and you get a before/after pair under the same filename.

import { expect, test } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import { createCode } from '@/fixtures/codes';
import { claim, login as loginAPI, createAPIToken } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession, goto } from '@/fixtures/navigate';

const SHOTS = path.join(process.cwd(), 'manual-runs', 'mobile-sweep');
const ROUTES_ROOT = path.join(process.cwd(), '..', 'app', 'src', 'app');

const OWNER = {
  email: 'mobile-sweep@example.com',
  password: 'a-narrow-viewport-is-a-real-viewport-1',
  handle: 'mobileowner',
  fullName: 'Mobile Owner',
};
const CODE = 'MOBILE-01';

// The corpus content needs to be **long enough**: only a body that overflows one screen
// reveals line width, line breaks, tables, and overflow. Every surface looks fine on an
// empty instance.
const LONG_BODY = [
  'StandMeet is a foundation for audience-tailored introduction. You curate a corpus of',
  'what you have actually done, and a queryable AI answers each visitor in your own voice,',
  'grounded in your own words, with a citation back to the note it read.',
  '',
  '## Why a corpus and not a résumé',
  '',
  'A résumé is one rendering for every reader. A corpus is the material, and the rendering',
  'happens per conversation — a recruiter, an investor and a collaborator ask different',
  'questions of the same body of work and should not be handed the same page.',
  '',
  'A table is here on purpose: it is the element most likely to force a horizontal scroll',
  'on a narrow screen, and the one a text assertion is least able to see.',
  '',
  '| surface | who it is for | what it holds |',
  '| --- | --- | --- |',
  '| index | anyone holding a code | prose, chat, insights, projects, status |',
  '| gate | a visitor without one | the code box, BYOAI, request access |',
  '| admin | the owner | twenty-six sections over one corpus |',
  '',
  '```go',
  'func longEnoughToOverflow(ctx context.Context, in *AssembleInput) (*Capability, error) {',
  '    return registry.VisitorBinding(ctx, in.SessionID, in.CorpusScope, in.Denials)',
  '}',
  '```',
].join('\n');

// publicRoutes -- reads the static public routes from the app router's directory
// structure. Excludes admin (walked via the sidebar below), dynamic segments (walked
// via the index page below), and setup / print / report, which need a one-time token.
function publicRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, url: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('[') || e.name.startsWith('(')) continue;
      const next = `${url}/${e.name}`;
      if (next.startsWith('/admin')) continue;
      if (['/setup', '/print', '/report'].some((p) => next.startsWith(p))) continue;
      if (fs.existsSync(path.join(dir, e.name, 'page.tsx'))) out.push(next);
      walk(path.join(dir, e.name), next);
    }
  };
  walk(ROUTES_ROOT, '');
  return ['/', ...out.sort()];
}

// settle -- waits for **this screen to actually stop moving** before pressing the shutter.
//
// Two conditions, each covering one way to shoot too early:
//   1) fonts haven't landed yet -> whatever line width, line breaks, and overflow get
//      measured are all shaped by the fallback font (`navigate.ts`'s goto waiting on
//      load is the same reasoning: a real person only looks at the page once the fonts
//      have landed).
//   2) the data hasn't come back yet -> what gets captured is the loading state. The
//      first version here only waited on fonts, and all 26 admin sections came back as
//      `loading…` next to a row of dashes -- while the whole suite was green, and
//      running unusually fast (3 minutes -> 40 seconds). **The speedup itself was the
//      evidence, that time.**
//
// What it waits for is **the product's own** "still loading" message disappearing, not
// a guessed-large enough number. While loading, this screen either renders skeletons
// (every `Skel` carries the `.skel` class) or literally says `loading…`; only once
// neither is present has it settled. `expect` retries on its own, so there's no sleep
// here, and no need for `networkidle` either -- both of those are proxy signals, while
// these two are signals the product emits itself.
const LOADING_TEXT = /loading…/;

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.locator('.skel')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(LOADING_TEXT)).toHaveCount(0, { timeout: 15_000 });
}

async function shoot(page: Page, name: string, full = false): Promise<void> {
  await settle(page);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
}

// Which credentials the adminPage fixture logs in with reads from ownerCredentials --
// without an override it uses the default set (alice@example.com), while this file
// claims its own instance with its own email, so the login page would stall on
// "invalid credentials" and the failure would surface inside the fixture, looking like
// admin failing to render at a narrow viewport.
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// The timeout is set on the describe block, not inside each test body -- calling
// `test.setTimeout` inside a test body **doesn't yet take effect during the fixture
// phase**: if the adminPage step is slow, it still hits the default 30s, and the
// resulting red surfaces inside the fixture, looking like a product problem. Shooting
// two images for each of 26 sections here is inherently slow.
test.describe.configure({ timeout: 600_000 });

test.describe('mobile sweep · 每个面留一张图', () => {
  test.beforeAll(async ({ playwright }) => {
    await seedInstance(await playwright.request.newContext());
  });

  test('公开面 · app router 上有几条静态路由就截几张', async ({ page }) => {
    const routes = publicRoutes();
    let i = 0;
    for (const route of routes) {
      i += 1;
      const name = route === '/' ? 'index' : route.slice(1).replace(/\//g, '-');
      await goto(page, route);
      await shoot(page, `pub-${String(i).padStart(2, '0')}-${name}`);
      // For the pages with a long scroll, also keep a full-page shot: the first screen
      // looking fine doesn't mean the whole page does.
      await shoot(page, `pub-${String(i).padStart(2, '0')}-${name}-full`, true);
    }
    test.info().annotations.push({
      type: 'routes', description: `${routes.length}: ${routes.join(' ')}`,
    });
  });

  test('公开阅读面 · 顺着索引点进文章', async ({ page }) => {
    // Never guess a slug -- click into whatever the index page lists first; the
    // product itself decides where the article lives.
    for (const [idx, name] of [['/wiki', 'wiki'], ['/writings', 'writings']] as const) {
      await goto(page, idx);
      await settle(page);
      // `:visible` is required. The desktop sidebar tree gets collapsed on a narrow
      // screen (this is **correct** responsive behavior), but the links are still in
      // the DOM, so `.first()` would grab an unclickable element and fail red as
      // "element is not visible" -- looking like the product can't reach articles on
      // mobile, when really it's the selector picking the wrong one
      // ([[harness-confusion-looks-like-a-defect]]). A mobile user follows the card
      // below instead.
      const link = page.locator(`a[href^="${idx}/"]:visible`).first();
      if (await link.count() === 0) {
        test.info().annotations.push({ type: 'empty-index', description: idx });
        continue;
      }
      await link.click();
      await page.waitForURL(new RegExp(`${idx}/.+`));
      await shoot(page, `read-01-${name}-article`);
      await shoot(page, `read-02-${name}-article-full`, true);
    }
  });

  test('访客面 · 身份 → 会话 → 答完一轮', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    const tag = await scriptMockReplyText(req, [
      'StandMeet is a stand-in that goes to meet people for you — an AI grounded in the',
      'owner’s own corpus, answering in their voice with a citation back to the note it',
      'read. It replaces the one-size-fits-all résumé with a rendering per conversation,',
      'so a recruiter and a collaborator are not handed the same page.',
    ].join(' '));
    await req.dispose();

    await goto(page, `/?code=${CODE}`);
    await shoot(page, 'visit-01-identity-modal');

    await enterCodeSession(page, CODE);
    await shoot(page, 'visit-02-session-open');

    const input = page.getByTestId('chat-input-field');
    await input.fill(`What is StandMeet?${tag}`);
    await input.press('Enter');
    await page.getByTestId('answer-body').last()
      .waitFor({ state: 'visible', timeout: 60_000 });
    await shoot(page, 'visit-03-answered');
    await shoot(page, 'visit-04-answered-full', true);

    // The citation drawer is the only place a visitor can check where an answer came
    // from -- if it collapses on a narrow screen, that's the same as having no citation.
    const refs = page.getByTestId('answer-citations').first();
    if (await refs.count() > 0) {
      await refs.click();
      await shoot(page, 'visit-05-citations-open');
    }
  });

  test('owner 面 · 侧栏上有几个分区就截几张', async ({ adminPage }) => {
    const slugs = await sweepAdminSections(adminPage);
    test.info().annotations.push({
      type: 'sections', description: `${slugs.length}: ${slugs.join(' ')}`,
    });
  });
});

// seedInstance -- a freshly claimed instance + one real piece of content in each of
// the three genres + one code. Content must be **real** and long enough: every surface
// looks fine on an empty instance, and what this suite of screenshots is meant to
// judge is exactly what happens once content stretches it out.
async function seedInstance(req: APIRequestContext): Promise<void> {
  resetInstance();
  await claim(req, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(req, OWNER.email, OWNER.password);
  const token = await createAPIToken(req, csrf, 'mobile-sweep');
  const sid = await initMCP(req, token);

  await seedPublicWiki(req, token, sid, {
    body: LONG_BODY, title: 'StandMeet', path: 'projects/standmeet',
  });
  await callTool(req, token, sid, 'writing_create', {
    slug: 'a-corpus-is-not-a-resume',
    title: 'A corpus is not a résumé',
    excerpt: 'One rendering for every reader is the thing being replaced.',
    body_md: LONG_BODY,
    cover_headline: 'corpus.', cover_hue: 'amber',
    tags: ['product', 'corpus'], publish: true,
  });
  await createCode(req, csrf, {
    code: CODE,
    label: 'mobile',
    ghosts: ['What is StandMeet?', 'How do you spend your time?'],
  });
  await req.dispose();
}

// sweepAdminSections -- walks every section the sidebar lists, keeps two shots of
// each, and returns the list it walked.
async function sweepAdminSections(adminPage: Page): Promise<string[]> {
  await shoot(adminPage, 'admin-00-landing');

  // On a narrow screen the sidebar is a drawer; it has to be pulled open before a
  // section is clickable. Keep a shot of this too: what it looks like with the drawer
  // covering the body is a surface this change newly created, and nobody has looked at
  // it before.
  const toggle = adminPage.getByTestId('admin-nav-toggle');
  await toggle.click();
  await shoot(adminPage, 'admin-00b-nav-drawer');

  const slugs = await adminPage.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="admin-nav-"]')]
      .map((e) => e.getAttribute('data-testid')!.replace('admin-nav-', ''))
      .filter((s) => s !== '' && s !== 'toggle'));

  let i = 1;
  for (const slug of slugs) {
    const n = String(i).padStart(2, '0');
    i += 1;
    // The drawer collapses itself after a click (correct behavior on switching
    // sections), so it needs to be pulled open again every time.
    const openIfClosed = (await adminPage.getByTestId(`admin-nav-${slug}`).isVisible())
      ? Promise.resolve()
      : toggle.click();
    await openIfClosed;
    await adminPage.getByTestId(`admin-nav-${slug}`).click();
    // Arrived at this section, and its own data has finished loading -- `shoot`'s
    // internal settle call covers the second half of that.
    await adminPage.waitForURL(new RegExp(`/admin/${slug}$`));
    await shoot(adminPage, `admin-${n}-${slug}`);
    await shoot(adminPage, `admin-${n}-${slug}-full`, true);
  }
  return slugs;
}
