// job-fetch-readable-text.spec.ts —— a fetched posting must be **text**, not markup.
//
// Driven out on the real environment (F-E-7): among 521 real postings in
// prod, the `hn_hiring` rows on `/admin/listings` showed raw markup for the
// entire row —
//   `IVPN | Infrastructure Engineer &#x2F; Sysadmin | Remote (…) | Full-time | <a href="https:&#x2F;…`
// while the greenhouse path's body is **doubly-escaped** HTML:
// `&lt;div class=&quot;content-intro&quot;&gt;…`. Not even an HTML parser
// saves the latter — it sees the literal `&lt;div&gt;`.
//
// **Don't confuse this with the already-declared design**: `hn_hiring.go:12-13`
// states "don't parse the comment's content structure — pass raw text to the
// agent and let Claude read it itself." That sentence governs **structure**
// (the Company | Title | Location split), not "leave HTML entities and tags
// sitting in a display field." title is a column people read.
//
// What's missing is a mechanism, not a field: `html.UnescapeString` / strip-tags
// gets zero hits anywhere along the jobs fetch path. So this spec asserts on
// two sources, neither optional — asserting only on HN would also pass a fix
// that just "patches the HN adapter", while greenhouse's body would still be
// `&lt;div&gt;` soup.

// **The second half of the same function (UX-88)**: `readableJobs`'s header
// comment says "every source's returned text must become plain text before
// entering the pool — this is their only convergence point," yet it only
// scanned title and body_text. Nobody handled location, so RemoteOK's
// `"San Francisco, "` (a city plus an empty region, comma left dangling at the
// end) prints verbatim onto `/admin/listings`, reading as `remoteok · Karratha,`.
// This case fills in the rest of that sentence: **normalize external data once
// at the entry point** (global rule #4).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource, jobsShow, MOCK_BASE } from '@/fixtures/jobs';

const OWNER = {
  email: 'jobtext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'jobtext',
  fullName: 'Job Text Owner',
};

// MARKUP —— things that should never literally appear in a real posting. All copied from that prod screen.
const MARKUP = [/&#x2F;/, /&#x27;/, /&amp;/, /&lt;/, /&quot;/, /<a\s/i, /<p>/i, /<div/i];

function expectReadable(label: string, text: string): void {
  for (const re of MARKUP) {
    expect(text, `${label} must read as text, not markup (${re})`).not.toMatch(re);
  }
}

test.describe('jobs · a fetched posting reads as text, not markup', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('the HN free-form source yields a readable title', async ({ request }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'jobtext-spec');
    const sid = await initMCP(request, token);

    await jobsRegisterSource(request, token, sid, {
      kind: 'hn_hiring', label: 'HN Who is Hiring', config: {},
    });
    const fetched = await jobsFetchNew(request, token, sid);
    const hn = fetched.jobs.filter((j) => j.source_kind === 'hn_hiring');
    // The precondition needs to be **exact**, not `> 0`. This thread's fixture
    // has 8 top-level comments, none deleted, so the count must be exactly 8.
    // `toBeGreaterThan(0)` once let **98 comments collapse into 1** slip right
    // through in the real environment (F-E-24): HN's URL is `item?id=…`, and
    // the cross-source dedup canonical key dropped the query string entirely,
    // so every comment in the whole thread ended up with the same key,
    // `https://news.ycombinator.com/item` ([[assertion-that-cannot-fail]]).
    expect(hn, '这一帖 fixture 的 8 条顶层评论都要活下来').toHaveLength(8);
    const urls = new Set(hn.map((j) => j.url));
    expect(urls.size, '每条各有各的 URL（塌成一条的话这里是 1）').toBe(8);

    // **A source that fetches item-by-item must account for what it skipped**
    // (F-E-19): a raw count alone can't distinguish "nobody's hiring today"
    // from "got rate-limited" from "the filter condition is wrong". The tally
    // must say: how many the upstream had, how many we looked at, and how many
    // were skipped for each reason.
    const tally = (fetched.sources ?? []).find((t) => t.kind === 'hn_hiring');
    expect(tally?.available, '上游那帖一共 8 条顶层评论').toBe(8);
    expect(tally?.read, '我们把这 8 条都过了一遍').toBe(8);
    expect(tally?.skipped, '跳过要按原因分开计数，不是一个总数').toEqual({
      fetch_failed: 0, deleted_or_empty: 0,
    });

    for (const j of hn) {
      expectReadable(`hn title (${j.cache_id})`, j.title);
    }
  });

  test('a board that ships HTML yields a readable body', async ({ request }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'jobtext-spec-2');
    const sid = await initMCP(request, token);

    await jobsRegisterSource(request, token, sid, {
      kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
    });
    const fetched = await jobsFetchNew(request, token, sid);
    const gh = fetched.jobs.filter((j) => j.source_kind === 'greenhouse');
    expect(gh.length, 'precondition: the greenhouse fixture produced postings').toBeGreaterThan(0);

    // The body goes through `jobs.show`: the list surface **does not send the
    // body** (F-E-29 — a single fetch today returns two or three hundred
    // postings, each body one to two thousand words, and stuffing all of it
    // into the receipt would burn through the owner's context budget). The
    // cleanup happens at the point of entering the pool, so both paths read
    // the same underlying bytes, and the "body is readable" criterion belongs
    // to whichever tool is declared to send the body.
    const bodies: { cacheID: string; body: string }[] = [];
    for (const j of gh) {
      const full = await jobsShow(request, token, sid, j.cache_id);
      if ((full.body_text ?? '').length > 0) {
        bodies.push({ cacheID: j.cache_id, body: full.body_text ?? '' });
      }
    }
    expect(bodies.length, 'precondition: at least one posting carries a body').toBeGreaterThan(0);
    for (const b of bodies) {
      expectReadable(`greenhouse body (${b.cacheID})`, b.body);
    }
  });

  test('a board that ships a dangling separator yields a clean location', async ({ request }) => {
    // **Verify the precondition against the stand-in itself first**
    // ([[assertion-that-cannot-fail]]): if someone ever "conveniently" scrubs
    // the trailing comma out of the fixture, the assertions below would all go
    // green — green with zero information. So ask the stand-in what it
    // actually sent first; if it can't produce dirty data, fail this case
    // outright rather than letting it pass quietly.
    await expectStandInStillShipsDanglingLocations(request);

    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'jobtext-spec-3');
    const sid = await initMCP(request, token);

    await jobsRegisterSource(request, token, sid, {
      kind: 'remoteok', label: 'RemoteOK', config: {},
    });
    const fetched = await jobsFetchNew(request, token, sid);
    const rok = fetched.jobs.filter((j) => j.source_kind === 'remoteok');
    expect(rok.length, 'precondition: the remoteok fixture produced postings').toBeGreaterThan(0);

    expectCleanLocations(rok);
  });

  // The **third half** of the same function (F-E-30). `readableJobs`'s header
  // comment "every source's returned text must become plain text before
  // entering the pool" scanned title and body_text, then location got added
  // later — but **company only gets TrimSpace**. The cost showed up in the
  // worst possible place: a committed resume PDF with a header reading
  // `STORE MANAGER · FOR JACK &AMP; JONES`, mailed out to a recruiter
  // (genuinely rendered like this in prod, `ac-52`).
  //
  // Real RemoteOK sends exactly this today: `"company":"JACK &amp; JONES"`. The stand-in has one entry patterned after it.
  test('a company name with an entity reads as text, not markup',
    ({ request }) => companyReadsAsText(request));
});

async function companyReadsAsText(request: APIRequestContext): Promise<void> {
  await expectStandInStillShipsEntityCompany(request);

  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'jobtext-spec-4');
  const sid = await initMCP(request, token);

  await jobsRegisterSource(request, token, sid, {
    kind: 'remoteok', label: 'RemoteOK', config: {},
  });
  const fetched = await jobsFetchNew(request, token, sid);
  const rok = fetched.jobs.filter((j) => j.source_kind === 'remoteok');
  expect(rok.length, 'precondition: the remoteok fixture produced postings').toBeGreaterThan(0);

  for (const j of rok) {
    expectReadable(`remoteok company (${j.cache_id})`, j.company);
  }
  expect(
    rok.some((j) => j.company.includes('JACK & JONES')),
    'the entity must have become an ampersand, not vanished',
  ).toBe(true);
}

// expectStandInStillShipsEntityCompany —— verifies the precondition against
// the stand-in itself ([[assertion-that-cannot-fail]]): if someone
// "conveniently" scrubs that `&amp;` out of the fixture, the whole case above
// would go green with zero information.
async function expectStandInStillShipsEntityCompany(
  request: APIRequestContext,
): Promise<void> {
  const upstream = await request.get(`${MOCK_BASE}/remoteok/api`);
  expect(upstream.ok(), 'precondition: the job-board stand-in answers').toBeTruthy();
  const raw = (await upstream.json()) as { company?: string }[];
  expect(
    raw.filter((e) => (e.company ?? '').includes('&amp;')).length,
    'precondition: the stand-in must still ship an HTML entity in a company name — '
    + 'real RemoteOK does (JACK &amp; JONES); if this is 0 the fixture was scrubbed',
  ).toBeGreaterThan(0);
}

// expectStandInStillShipsDanglingLocations —— **verifies the precondition
// against the stand-in itself** ([[assertion-that-cannot-fail]]): if someone
// ever "conveniently" scrubs the trailing comma out of the fixture, the
// assertions below would all go green — green with zero information. So ask
// the stand-in what it actually sent first; fail if it can't produce dirty data.
async function expectStandInStillShipsDanglingLocations(
  request: APIRequestContext,
): Promise<void> {
  const upstream = await request.get(`${MOCK_BASE}/remoteok/api`);
  expect(upstream.ok(), 'precondition: the job-board stand-in answers').toBeTruthy();
  const raw = (await upstream.json()) as { id?: string; location?: string }[];
  const dangling = raw.filter((e) => e.id && DANGLING.test(e.location ?? ''));
  expect(
    dangling.length,
    'precondition: RemoteOK really does ship "City, " with an empty region — '
    + 'if this is 0 the fixture was scrubbed and this whole test proves nothing',
  ).toBeGreaterThan(0);
}

const DANGLING = /[,;\-–]\s*$/;

function expectCleanLocations(jobs: { cache_id: string; location: string }[]): void {
  for (const j of jobs) {
    expect(
      j.location,
      `remoteok location (${j.cache_id}) must not end on a separator — `
      + 'the listing reads "remoteok · Karratha," to the owner',
    ).not.toMatch(DANGLING);
    expect(
      j.location,
      `remoteok location (${j.cache_id}) must not carry edge whitespace`,
    ).toBe(j.location.trim());
  }
  // Normalization must not eat real content: a genuine "City, Region" with both parts present must survive intact.
  for (const j of jobs.filter((x) => x.location.includes(','))) {
    expect(
      j.location,
      'a genuine "City, Region" must survive normalisation intact',
    ).toMatch(/[^,\s],\s*\S/);
  }
}
