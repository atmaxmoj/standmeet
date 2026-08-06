// corpus-i18n-write.spec.ts —— the two intakes, and their two different tempers.
//
// The MCP write op REFUSES a broken multilingual note: an agent that gets an error can fix it and
// retry, and a note that renders half its content in front of a reader gives no such signal.
// `corpus.check_i18n` answers with the SAME diagnostics and writes nothing — two separate judgements
// would eventually disagree, and then "it checked out but would not save" is all the agent knows.
//
// (vault sync is the third intake and has the opposite temper — it accepts and reports, because it
// is a mirror and refusing means the owner loses content. That one is covered where sync is.)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { callTool, initMCP } from '@/fixtures/mcp';
import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';

const OWNER = {
  email: 'i18nwrite@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'i18nwrite',
  fullName: 'I18n Write Owner',
};

// An empty pane: the reader who picks zh gets nothing at all, and nothing says so.
const BROKEN = '> [!i18n]\n> > [!lang] en\n> > English body.\n>\n> > [!lang] zh\n';
// The minimum form: nested callouts, zero frontmatter.
const MINIMAL = '> [!i18n]\n> > [!lang] en\n> > English body.\n>\n> > [!lang] zh\n> > 中文正文。\n';

let api: APIRequestContext;
let token = '';
let sid = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  api = await playwright.request.newContext();
  await claim(api, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
  token = await createAPIToken(api, csrf, 'i18n-write');
  sid = await initMCP(api, token);
});

test.afterAll(async () => { await api.dispose(); });

test.describe('corpus.create · a broken multilingual body is refused', () => {
  test('the write is rejected, names the problem, and carries a copyable example', async () => {
    const err = await callTool(api, token, sid, 'corpus.create', {
      genre: 'wiki', title: 'Broken', body: BROKEN,
    }).then(() => '', (e: Error) => e.message);

    expect(err, 'the call fails rather than writing a half-note').not.toBe('');
    expect(err, 'says which pane').toMatch(/pane is empty/i);
    // The guidance is in the ERROR, not in the tool description: descriptions are paid for on
    // every call and routinely skipped; an error arrives exactly when it is needed.
    expect(err, 'and shows the shape to copy').toContain('[!lang] en');
  });

  test('and the note was NOT created', async () => {
    const list = await callTool<{ title: string }[]>(
      api, token, sid, 'corpus.list', { genre: 'wiki' },
    );
    expect(list.some((e) => e.title === 'Broken'), 'nothing was written').toBe(false);
  });

  test('the minimum form — nested callouts, no frontmatter — is accepted', async () => {
    const created = await callTool<{ id: string; title: string }>(
      api, token, sid, 'corpus.create', { genre: 'wiki', title: 'Minimal', body: MINIMAL },
    );
    expect(created.title).toBe('Minimal');
  });
});

test.describe('corpus.check_i18n · the same answer, without writing', () => {
  test('reports the same diagnostic the write op refused on', async () => {
    const out = await callTool<{
      acceptable: boolean;
      diagnostics: { code: string; message: string; severity: string }[];
      languages: string[];
      minimal_example?: string;
    }>(api, token, sid, 'corpus.check_i18n', { body: BROKEN });

    expect(out.acceptable, 'the same verdict the write op reached').toBe(false);
    expect(out.diagnostics.map((d) => d.code)).toContain('empty_pane');
    expect(out.minimal_example ?? '', 'the same example too').toContain('[!lang] zh');
  });

  test('and writes nothing', async () => {
    const list = await callTool<{ title: string }[]>(
      api, token, sid, 'corpus.list', { genre: 'wiki' },
    );
    expect(list.length, 'only the accepted note exists').toBe(1);
  });

  test('a good body reports the languages it found', async () => {
    const out = await callTool<{ acceptable: boolean; languages: string[] }>(
      api, token, sid, 'corpus.check_i18n', { body: MINIMAL },
    );
    expect(out.acceptable).toBe(true);
    expect(out.languages, 'inferred from the panes, not from frontmatter').toEqual(['en', 'zh']);
  });

  test('a warning is not a refusal — a duplicate pane still writes', async () => {
    const dup = '> [!i18n]\n> > [!lang] en\n> > first\n>\n> > [!lang] en\n> > second\n';
    const out = await callTool<{ acceptable: boolean; diagnostics: { code: string }[] }>(
      api, token, sid, 'corpus.check_i18n', { body: dup },
    );
    expect(out.diagnostics.map((d) => d.code)).toContain('duplicate_pane');
    expect(out.acceptable, 'translation-quality problems do not block a write').toBe(true);
  });
});
