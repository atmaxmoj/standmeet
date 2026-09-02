// corpus-search-cjk-not-silent.spec.ts —— F-S-2: a Chinese query against a
// corpus that contains Chinese comes back empty-handed, and that emptiness
// says nothing about why.
//
// How this was found: on prod, someone asked "what does the corpus say about
// 'recursive convergence'?" and the agent fired two parallel queries in one
// turn: `递归收敛` (Chinese) and `recursive convergence`. Once call_id was
// added (F-S-1), the logs separated them:
//   call_00… query="递归收敛"              result_bytes:2      ← []
//   call_01… query="recursive convergence" result_bytes:7883
// The corpus **does** contain Chinese (the vault's `> [!i18n]` bilingual
// contract puts a full Chinese paragraph in note bodies), so this isn't "no
// material". The direct cause is in `corpus_notes.sql.go:1244-1250`:
// `to_tsvector('english', …)` is hardcoded, and the English tokenizer splits
// on whitespace — Chinese has none, so the whole span collapses into **one**
// token. The database's own output confirms it:
//   to_tsvector('english','递归会收敛因为压缩映射') → '递归会收敛因为压缩映射':1
//
// **What this asserts is "must not stay silent", not "must hit."** The
// repo's second retrieval path (`corpus_grep`, literal/regex, never-miss)
// already states up front that it covers "Chinese bigrams that cross
// tokenizer boundaries" — the capability already exists. The same file's
// line 12 states the design intent: the two paths must **stay distinct**;
// merging them just leaves the agent guessing blind. So the fix isn't having
// corpus_search secretly do grep's job — it's that when its own tokenizer
// can't represent the query, it **must not return a bare `[]`** — it has to
// say "this path doesn't match your query." The choice still belongs to the
// agent, but now it has the information it needs to choose.
//
// Why this assertion reads the logs instead of the product surface: the
// answer the visitor sees is **correct** — the English query pulled back
// content and the answer generates normally, while the Chinese query comes
// back empty and leaves no trace. The defect is structurally invisible at
// the UI.
//
// ┌─────────────────────────────────────────────────────────────────────────────────────────┐
// │ ⚠️ This case does NOT protect against that defect today — don't count its green yet.      │
// │                                                                                          │
// │ It went green the first time it ran — and it should have been red. Not because the       │
// │ defect doesn't exist, but because **it ran on a different retrieval path**:               │
// │ `docker-compose.dev.yml:56-57` wires `MEILI_URL` into the dev stack, and **prod has no    │
// │ meilisearch at all** (the term doesn't appear in the prod compose file). Meili segments   │
// │ CJK, so Chinese queries succeed in e2e; prod goes through PG's                            │
// │ `to_tsvector('english', …)`, where the Chinese span collapses into one token and misses.  │
// │                                                                                          │
// │ So this assertion is testing **the path that happens to work**; its green says nothing    │
// │ about prod. This is exactly                                                               │
// │ [[verifier-can-lie-about-its-own-coverage]]: check what the guard **actually scans**       │
// │ first, don't just check that it's green.                                                  │
// │                                                                                          │
// │ And this matters beyond F-S-2 itself: corpus-search's own item, check 4, states that      │
// │ "prod's default IS the fallback path — verify it as the **main** path, not as an          │
// │ emergency" — **every search-related e2e is testing Meili**. For this case to become a     │
// │ real guard, there first needs to be a way to run e2e on the PG path (turn Meili off, or   │
// │ add a forced-fallback switch). That mechanism doesn't exist yet, so this comment states    │
// │ the situation plainly rather than leaving a green that lies.                              │
// └─────────────────────────────────────────────────────────────────────────────────────────┘

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { publishEntry, seedPublicWiki } from '@/fixtures/corpus';
import {
  resetInstance, findSetupToken, backendLogTail, setSearchDegraded,
} from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockParallelToolCalls } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'cjk-search@example.com', password: 'correct-horse-battery-staple',
  handle: 'cjksearch', fullName: 'CJK Search Owner',
};
const CODE = 'CJKQ-01';
// The note body follows the real vault's bilingual shape: Chinese and English in the same
// paragraph. English is found, Chinese is not — the only remaining variable is query language.
const NOTE_BODY = [
  'Recursion compounds value only if it converges — a contracting reassembly bounds the error.',
  '',
  '递归会收敛因为压缩映射把误差一层层压下去，这是安全递归的核心条件。',
].join('\n');

test.describe('F-S-2 · a CJK query must not come back empty-handed and silent', () => {
  test.beforeAll(async ({ playwright }) => {
    await seedOwner(playwright);
    // **Running on the degraded path is what this case's validity depends on.** The box at
    // the top records why it went green the first time: dev has Meili wired up, and Meili
    // segments CJK, so it was testing the path that works. Only once the mechanism exists
    // (`make dev-pgsearch-on`) does it face the path where the defect actually is.
    setSearchDegraded(true);
  });

  test.afterAll(() => { setSearchDegraded(false); });

  test('CJK and English search the same bilingual note; the CJK one must say something',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      // Fire both in the same turn, in parallel — this way both searches face the same
      // corpus at the same moment, and the only variable is query language.
      const tag = await scriptMockParallelToolCalls(request, [
        { name: 'corpus_search', args: { query: 'contracting reassembly converges' } },
        { name: 'corpus_search', args: { query: '压缩映射' } },
      ]);
      await request.dispose();

      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`hello${tag}`);
      await input.press('Enter');
      const progress = page.getByTestId('chat-progress');
      await expect(progress).toBeVisible({ timeout: 15_000 });
      await expect(progress).toBeHidden({ timeout: 30_000 });

      const results = searchResultsByQuery(backendLogTail());
      const english = results.get('contracting reassembly converges');
      const cjk = results.get('压缩映射');

      // Positive control: the English query **must** hit. Without this, the assertion below
      // would also go red for no obvious reason when search is broken entirely, and the
      // red would get blamed on CJK ([[red-in-the-wrong-place]]).
      expect(english, 'the English query produced a result at all').toBeDefined();
      expect(english ?? 0, 'the English query finds the bilingual note').toBeGreaterThan(2);

      // When the Chinese query comes back empty, it **is no longer a bare 2-byte `[]`**
      // (F-S-2 is fixed): the response carries the line "empty does not mean absent, this
      // index depends on tokenization, use corpus_grep to be sure" — so it's larger than an
      // empty array.
      //
      // ⚠️ An earlier version of this comment said "this wire stays as-is,
      // `tool-endpoint-corpus.spec.ts:146` pins `[]`." Reading that test: it only asserts
      // `status==200 && body.ok==true`, it **never pinned the shape** — a false blocker
      // written as a "reason" froze this for a whole cycle
      // ([[blocker-written-as-reason-ossifies]]).
      //
      // What's asserted now is the fact itself that "it said something when empty-handed."
      // The byte count is just its shadow; the exact wording is guarded word-for-word by
      // corpus-search-says-when-it-cannot-see-the-query.spec.ts.
      expect(cjk, 'the CJK query produced a result at all').toBeDefined();
      expect(cjk ?? -1, '空手回执必须带上那句提醒，不能是个裸的空数组')
        .toBeGreaterThan(2);
    });

  // ④ lands at the **decision point**, so the guard lands at the decision point too.
  //
  // The empty-array wire is pinned down, so the hint can't be hung on it there; the agent
  // decides which retrieval path to use **at the moment it reads the tool description**,
  // not at the moment it gets an empty array back. So corpus_search's description must say
  // two things itself: this index can miss, and where to go when it does (corpus_grep,
  // never-miss).
  test('corpus_search tells the agent an empty result is not proof of absence',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: CODE, visitor_name: 'Desc Reader',
      });
      const specs = await sessionToolSpecs(request, sess.session_token);
      await request.dispose();

      // Positive control: this session actually got handed a tool list. An empty list would
      // make every not/contains assertion below "pass" too.
      expect(specs.length, 'the session was handed a tool list at all').toBeGreaterThan(0);
      const search = specs.find((t) => t.name === 'corpus_search');
      expect(search, 'corpus_search is among them').toBeDefined();

      const desc = (search?.description ?? '').toLowerCase();
      expect(desc, 'it says an empty result does not mean the corpus lacks the topic')
        .toContain('does not mean the corpus lacks');
      expect(desc, 'and it names the never-miss path to switch to').toContain('corpus_grep');
    });
});

interface ToolSpecRow { name: string; description?: string }

async function sessionToolSpecs(
  request: APIRequestContext, sessionToken: string,
): Promise<ToolSpecRow[]> {
  const res = await request.get(`${BACKEND}/internal/diag/session`, {
    headers: { 'X-Session-Token': sessionToken },
  });
  expect(res.status(), 'diag/session answered').toBe(200);
  const body = await res.json() as { tool_specs: ToolSpecRow[] };
  return body.tool_specs;
}

// searchResultsByQuery —— pairs the query from the start line with the result_bytes from
// the done line, by call_id.
//
// **Paired by call_id, not by order of appearance** — these two calls are dispatched in
// parallel, so order doesn't count. This field is what F-S-1 added; before that, this case
// couldn't have been written at all, because the two done lines look identical.
function searchResultsByQuery(log: string): Map<string, number> {
  const queryOf = new Map<string, string>();
  const out = new Map<string, number>();
  for (const line of log.split('\n')) {
    const id = /"call_id":"([^"]+)"/.exec(line)?.[1];
    if (id === undefined || !line.includes('"corpus_search"')) continue;
    const q = /\\"query\\": ?\\"([^\\]*)\\"/.exec(line)?.[1];
    if (q !== undefined) { queryOf.set(id, q); continue; }
    const bytes = /"result_bytes":(\d+)/.exec(line)?.[1];
    const known = queryOf.get(id);
    if (bytes !== undefined && known !== undefined) out.set(known, Number(bytes));
  }
  return out;
}

async function seedOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'cjk-seed');
  const sid = await initMCP(request, token);
  const note = await seedPublicWiki(request, token, sid, {
    body: NOTE_BODY, title: 'recursion-convergence-contraction',
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id: note.wikiID });
  const role = await createRole(request, csrf, {
    name: 'cjk-role', description: 'cjk search spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, { code: CODE, label: 'cjk', role_id: role.id });
  await request.dispose();
}
