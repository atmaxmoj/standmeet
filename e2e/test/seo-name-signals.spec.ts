// seo-name-signals.spec.ts —— a crawler reading the raw HTML (no JavaScript) learns whose site this
// is: the owner's name in one clean <title>, a schema.org Person, canonical URLs, and a sitemap that
// lists every public page.
//
// Found 2026-09-30 when the owner searched Google for their own name and sijie.xyz did not show
// (read-only investigation of the live HTML):
//   · the homepage had TWO <title> and TWO description tags — the site-root SEO was injected ahead
//     of the ones the home page's own JSX renders, never replacing them;
//   · no JSON-LD at all: nothing tells a search engine the page is a person, or which person;
//   · no canonical / og:url;
//   · published writings were missing from sitemap.xml;
//   · wiki pages were titled with the bare slug and "StandMeet", never the owner's name;
//   · HEAD / answered 405 (link previewers and SEO tools send HEAD first).
// Each assertion below reads what a crawler reads, and each was red on the code of that day.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createCode } from '@/fixtures/codes';
import { bindCodeToPage, publishPage } from '@/fixtures/microsite-rig';

const APP_BASE = process.env['APP_BASE_URL'] ?? 'http://localhost:38127';

const OWNER = {
  email: 'seoname@example.com', password: 'correct-horse-battery-staple',
  handle: 'seoname', fullName: 'Mei Lin Chan',
};
const WIKI_PATH = 'notes/why-names-matter';
const WRITING_SLUG = 'a-published-essay';
const MICRO_SLUG = 'portfolio';
const CLOSED_SLUG = 'for-a-recruiter';

// HOME —— a home page that renders its own <title> and description in JSX (React hoists them into
// <head>), as the live one does. The site-root SEO must replace them, not sit beside them.
const HOME = `
export default function App() {
  return (
    <main>
      <title>A tagline, not a name</title>
      <meta name="description" content="the page's own description" />
      <h1>Hello</h1>
    </main>
  );
}
`.trim();

// serial: the homepage cases rewrite the one site-root SEO; run in parallel they overwrite each other.
test.describe.configure({ mode: 'serial', timeout: 480_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(480_000);
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'seo-name');
  const sid = await initMCP(request, token);
  const { wikiID } = await seedPublicWiki(request, token, sid, {
    title: 'Why names matter', body: 'A note about names.', path: WIKI_PATH,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id: wikiID, excerpt: 'A note about names.' });
  await callTool(request, token, sid, 'writing_create', {
    slug: WRITING_SLUG, title: 'A published essay', body: 'Essay body.', publish: true,
  });
  await publishPage(request, csrf, 'home', HOME, 300_000);
  await publishPage(request, csrf, MICRO_SLUG, 'export default function App(){return <main>work</main>;}', 300_000);
  // A page bound to a code opens only with that code (binding closes it): a crawler has no code.
  await publishPage(request, csrf, CLOSED_SLUG, 'export default function App(){return <main>for you</main>;}', 300_000);
  const code = await createCode(request, csrf, { code: 'SEO-CLOSED-1', label: 'recruiter' });
  await bindCodeToPage(request, csrf, code.id, CLOSED_SLUG);
  await request.dispose();
});

// setHomeSEO —— the site-root SEO, set the way an owner's AI sets it: the owner MCP tool.
async function setHomeSEO(request: APIRequestContext, title: string, description: string): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, `seo-home-${Date.now()}`);
  const sid = await initMCP(request, token);
  await callTool(request, token, sid, 'microsite.set_seo', {
    slug: 'home', seo_title: title, seo_description: description, seo_image: '',
  });
}

async function rawHTML(request: APIRequestContext, path: string): Promise<string> {
  const res = await request.get(`${APP_BASE}${path}`, { maxRedirects: 0 });
  expect(res.status(), `GET ${path}`).toBe(200);
  return res.text();
}

const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length;
const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/gi;
const DESCRIPTION = /<meta\s+name=["']description["'][^>]*>/gi;

function jsonLD(html: string): Record<string, unknown>[] {
  const blocks = [...html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return blocks.map((m) => JSON.parse(m[1] ?? '{}') as Record<string, unknown>);
}

test.describe('the homepage says whose site this is', () => {
  test('one <title> — the owner\'s name when no SEO title is set', async ({ request }) => {
    await setHomeSEO(request, '', '');
    const html = await rawHTML(request, '/');
    expect(count(html, TITLE), 'exactly one <title>').toBe(1);
    expect([...html.matchAll(TITLE)][0]?.[1]).toContain(OWNER.fullName);
  });

  test('one <title> and one description — the site-root SEO replaces the page\'s own', async ({ request }) => {
    await setHomeSEO(request, 'Mei Lin Chan (陳美琳) — engineer', 'Mei Lin Chan builds things.');
    const html = await rawHTML(request, '/');
    expect(count(html, TITLE), 'exactly one <title>').toBe(1);
    expect([...html.matchAll(TITLE)][0]?.[1]).toBe('Mei Lin Chan (陳美琳) — engineer');
    expect(count(html, DESCRIPTION), 'exactly one description').toBe(1);
    expect(html).toContain('content="Mei Lin Chan builds things."');
  });

  test('a schema.org Person names the owner, and the page states its canonical URL', async ({ request }) => {
    const html = await rawHTML(request, '/');
    const person = jsonLD(html).find((j) => j['@type'] === 'Person');
    expect(person, 'a Person JSON-LD block').toBeDefined();
    expect(person?.['name']).toBe(OWNER.fullName);
    expect(String(person?.['url'])).toBe(APP_BASE);
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="${APP_BASE}/?">`));
    expect(html).toMatch(new RegExp(`<meta property="og:url" content="${APP_BASE}/?">`));
  });

  test('HEAD / answers 200 (link previewers and SEO tools ask HEAD first)', async ({ request }) => {
    const res = await request.head(`${APP_BASE}/`, { maxRedirects: 0 });
    expect(res.status()).toBe(200);
  });
});

test.describe('every public page carries the owner and its own address', () => {
  test('a microsite states its canonical URL', async ({ request }) => {
    const html = await rawHTML(request, `/p/${MICRO_SLUG}`);
    expect(html).toContain(`<link rel="canonical" href="${APP_BASE}/p/${MICRO_SLUG}">`);
    expect(html).toContain(`<meta property="og:url" content="${APP_BASE}/p/${MICRO_SLUG}">`);
  });

  test('a wiki page\'s title names the owner', async ({ request }) => {
    const html = await rawHTML(request, `/wiki/${WIKI_PATH}`);
    const title = [...html.matchAll(TITLE)][0]?.[1] ?? '';
    expect(title).toContain('Why names matter');
    expect(title).toContain(OWNER.fullName);
  });

  test('the sitemap lists published writings', async ({ request }) => {
    const res = await request.get(`${APP_BASE}/sitemap.xml`);
    expect(await res.text()).toContain(`<loc>${APP_BASE}/writings/${WRITING_SLUG}</loc>`);
  });

  // Found 2026-09-30 on sijie.xyz: the sitemap listed /p/mattermost, a page bound to a code, which
  // sends a visitor without one (every crawler) to /gate. The sitemap lists what a crawler can read.
  test('the sitemap lists open microsites, not ones that need a code', async ({ request }) => {
    const res = await request.get(`${APP_BASE}/sitemap.xml`);
    const body = await res.text();
    expect(body).toContain(`<loc>${APP_BASE}/p/${MICRO_SLUG}</loc>`);
    const closed = await request.get(`${APP_BASE}/p/${CLOSED_SLUG}`, { maxRedirects: 0 });
    expect(closed.status(), 'the bound page turns a codeless visitor away').toBe(302);
    expect(body.split('\n').filter((l) => l.includes(`/p/${CLOSED_SLUG}<`)),
      'no sitemap entry for a page that needs a code').toEqual([]);
  });
});
