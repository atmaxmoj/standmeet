// embed-update-hook.spec.ts —— Phase 3 of docs/design/event-bus-outbox-webhooks.md: the corpus
// tells its embeds. A site that embeds the corpus (standmeet.com) gives the embed an Update hook
// URL; every change inside the embed's code scope then reaches it as a signed thin event, and the
// site re-reads the cards whose updated_at moved.
//
// Contract (red on the unchanged code):
//   • The embed form (embed-form, opened by embed-edit-<id>) has embed-update-hook-url. Saving a
//     URL creates the webhook endpoint attached to the embed, with event_types
//     [corpus.note.changed]; the secret is shown once in embed-update-hook-secret.
//   • embeds.update {embed_id, update_hook_url} → the embed with update_hook: {endpoint_id, url}
//     and, only when the endpoint was just created, secret. (Same op behind admin PATCH /embeds/{id}.)
//   • Scope = the embed's code: role corpus globs minus the code's corpus denials — the same single
//     ACL predicate as retrieval. Published or not does not matter for an embed hook; raw never leaves.
//   • GET /api/v1/corpus-cards carries updated_at on every card: the entry's own last change.

import type { Page } from '@playwright/test';

import { test, expect } from '@/fixtures/test';
import { login as loginAPI } from '@/fixtures/admin';
import { createCode, findCode } from '@/fixtures/codes';
import { callTool } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { gotoAdminSection } from '@/fixtures/navigate';
import { seedWiki } from '@/fixtures/corpus';
import { setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { BACKEND } from '@/fixtures/stack';
import {
  accepted, createEmbedFor, received, resetSink, setEmbedHook, sinkURL, verifySignature,
  type HookedEmbed, type SinkDelivery,
} from '@/fixtures/webhooks';

let O: RetrievalOwner;
let csrf = '';
let fullRoleID = '';

const NOTE = 'corpus.note.changed';

async function codeID(code: string): Promise<string> {
  return (await findCode(O.request, csrf, code)).id;
}

// freshCode —— an embed takes a code of its own (embeds.code_id is unique), so each case issues one.
async function freshCode(name: string): Promise<string> {
  const code = `EMBEDHOOK-${name.toUpperCase()}`;
  await createCode(O.request, csrf, { code, label: name, assumed_role_id: fullRoleID });
  return code;
}

async function embedOn(code: string): Promise<HookedEmbed> {
  return createEmbedFor(O, await codeID(code), `embed-${code}`);
}

function noteSubjects(ds: SinkDelivery[]): string[] {
  return [...new Set(accepted(ds).filter((d) => d.body.type === NOTE).map((d) => d.body.subject))];
}

async function waitFor(sink: string, subject: string): Promise<SinkDelivery[]> {
  let got: SinkDelivery[] = [];
  await expect.poll(async () => {
    got = await received(O.request, sink);
    return noteSubjects(got).includes(subject);
  }, { timeout: 60_000, intervals: [500] }).toBe(true);
  return got;
}

async function hookFromTheForm(adminPage: Page): Promise<void> {
  const embed = await embedOn(O.fullCode);
  await gotoAdminSection(adminPage, 'embeds');
  await adminPage.getByTestId(`embed-edit-${embed.id}`).click();
  // The hook belongs to the copy mode (see *Embed sync mode*).
  await adminPage.getByTestId('embed-sync-mode-copy').check();
  await adminPage.getByTestId('embed-update-hook-url').fill(sinkURL('embed-ui'));
  await adminPage.getByTestId('embed-save').click();
  const secret = (await adminPage.getByTestId('embed-update-hook-secret').innerText()).trim();
  expect(secret).toMatch(/^whsec_/);
  const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, { title: 'Embed hook note', body: 'v1', path: 'embed-hook-note' });
  await callTool(O.request, O.apiToken, O.sid, 'corpus.update', {
    genre: 'wiki', id: wikiID, title: 'Embed hook note', body: 'v2', tags: [],
  });
  const got = await waitFor('embed-ui', 'wiki://embed-hook-note');
  const d = accepted(got).find((x) => x.body.subject === 'wiki://embed-hook-note') as SinkDelivery;
  expect(verifySignature(d, secret)).toBe(true);
}

async function scopeIsTheCodes(): Promise<void> {
  const embed = await embedOn(O.narrowCode); // role: wiki://projects/**
  await setEmbedHook(O, embed.id, 'embed-narrow');
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'Out of scope', body: 'x', path: 'elsewhere/out-of-scope' });
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'In scope', body: 'x', path: 'projects/in-scope' });
  await seedWiki(O.request, O.apiToken, O.sid, { title: 'Scope sentinel', body: 'x', path: 'projects/scope-sentinel' });
  const got = await waitFor('embed-narrow', 'wiki://projects/scope-sentinel');
  expect(noteSubjects(got).filter((s) => !s.endsWith('/projects'))).toEqual([
    'wiki://projects/in-scope', 'wiki://projects/scope-sentinel',
  ]);
}

async function sameURLSameEndpoint(): Promise<void> {
  const embed = await embedOn(await freshCode('same'));
  const first = await setEmbedHook(O, embed.id, 'embed-same');
  expect(first.secret).toMatch(/^whsec_/);
  const again = await setEmbedHook(O, embed.id, 'embed-same');
  expect(again.update_hook?.endpoint_id).toBe(first.update_hook?.endpoint_id);
  expect(again.secret).toBeUndefined();
}

async function deleteCarriesSubject(): Promise<void> {
  const embed = await embedOn(await freshCode('delete'));
  await setEmbedHook(O, embed.id, 'embed-delete');
  const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, { title: 'Soon deleted', body: 'x', path: 'soon-deleted' });
  await callTool(O.request, O.apiToken, O.sid, 'corpus.delete', { genre: 'wiki', id: wikiID });
  await expect.poll(async () => accepted(await received(O.request, 'embed-delete'))
    .some((d) => d.body.subject === 'wiki://soon-deleted' && d.body.data['op'] === 'deleted'), { timeout: 60_000 }).toBe(true);
}

// cardsCarryTheLastChange —— a card's updated_at is the entry's own last change (to the second, the
// precision the card metadata carries), before and after an edit.
async function cardsCarryTheLastChange(): Promise<void> {
  const cardAt = async (): Promise<number> => {
    const res = await O.request.get(`${BACKEND}/api/v1/corpus-cards`);
    const cards = ((await res.json()) as { cards: { path: string; updated_at: string }[] }).cards;
    return Math.floor(Date.parse(cards.find((c) => c.path === 'card-clock')?.updated_at ?? '') / 1_000);
  };
  const entryAt = async (id: string): Promise<number> => {
    const e = await callTool<{ updated_at: string }>(O.request, O.apiToken, O.sid, 'corpus.get', { genre: 'wiki', id });
    return Math.floor(Date.parse(e.updated_at) / 1_000);
  };
  const { id } = await callTool<{ id: string }>(O.request, O.apiToken, O.sid, 'corpus.create', {
    genre: 'wiki', title: 'Card clock', body: 'x', tags: [],
  });
  await callTool(O.request, O.apiToken, O.sid, 'seo.set_entry_seo', { genre: 'wiki', id, published: true, excerpt: '' });
  expect(await cardAt()).toBe(await entryAt(id));
  await callTool(O.request, O.apiToken, O.sid, 'corpus.update', { genre: 'wiki', id, title: 'Card clock', body: 'y', tags: [] });
  expect(await cardAt()).toBe(await entryAt(id));
}

test.use({ ownerCredentials: { email: 'embedhook@example.com', password: 'correct-horse-battery-staple' } });
test.describe('P3 · embed update hook', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'embedhook');
    ({ csrf } = await loginAPI(O.request, O.email, O.password));
    fullRoleID = (await createRole(O.request, csrf, {
      name: 'hookfull', description: 'all corpus', corpus_uris: ['wiki://**', 'output://**'],
    })).id;
    await resetSink(O.request);
  });
  test.afterAll(async () => { await O.request.dispose(); });

  test('the embed form\'s Update hook URL attaches an endpoint; an edit arrives signed',
    ({ adminPage }) => hookFromTheForm(adminPage));
  test('scope is the code\'s: outside the narrow code\'s globs never arrives (sentinel form)', scopeIsTheCodes);
  test('saving the same URL again keeps the endpoint and shows no new secret', sameURLSameEndpoint);
  test('a delete arrives with the last known subject', deleteCarriesSubject);
  test('corpus cards carry updated_at: the entry\'s own last change', cardsCarryTheLastChange);
});
