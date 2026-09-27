// embed-sync-mode.spec.ts —— docs/design/event-bus-outbox-webhooks.md, *Embed sync mode*. Each embed
// says how the consuming site keeps up with the corpus: `copy` (the site keeps a copy, the update hook
// tells it what changed) or `live` (the site reads the instance per request; no hook). The embed owns
// the fact; the site reads it by the embed's public key id.
//
// Contract (red on the unchanged code):
//   • embeds.create defaults to live; embeds.update takes sync_mode.
//   • GET /api/v1/embeds/{kid} → {kid, sync_mode}, nothing secret.
//   • copy + update_hook_url attaches the endpoint; switching to live deletes it.
//   • live + update_hook_url → refused with "a live embed has no update hook".
//   • The embed form offers the choice (embed-sync-mode-live / embed-sync-mode-copy).

import { test, expect } from '@/fixtures/test';
import { login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { callTool } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { gotoAdminSection } from '@/fixtures/navigate';
import { seedWiki } from '@/fixtures/corpus';
import { setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { BACKEND } from '@/fixtures/stack';
import {
  accepted, createEmbedFor, endpointIDs, publicSyncMode, received, resetSink, setEmbedHook,
  setEmbedLive, sinkURL, tryUpdateEmbed, type HookedEmbed,
} from '@/fixtures/webhooks';

let O: RetrievalOwner;
let csrf = '';
let roleID = '';

async function embedOnFreshCode(name: string): Promise<HookedEmbed> {
  const code = `SYNCMODE-${name.toUpperCase()}`;
  await createCode(O.request, csrf, { code, label: name, assumed_role_id: roleID });
  const res = await O.request.get(`${BACKEND}/api/admin/codes`, { headers: { 'X-Csrftoken': csrf } });
  const id = (await res.json() as { id: string; code: string }[]).find((c) => c.code === code)?.id ?? '';
  return createEmbedFor(O, id, `embed-${name}`);
}

async function arrives(sink: string, subject: string): Promise<void> {
  await expect.poll(async () => accepted(await received(O.request, sink))
    .some((d) => d.body.subject === subject), { timeout: 60_000, intervals: [500] }).toBe(true);
}

test.use({ ownerCredentials: { email: 'syncmode@example.com', password: 'correct-horse-battery-staple' } });
test.describe('P3 · embed sync mode', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'syncmode');
    ({ csrf } = await loginAPI(O.request, O.email, O.password));
    roleID = (await createRole(O.request, csrf, {
      name: 'syncfull', description: 'all corpus', corpus_uris: ['wiki://**'],
    })).id;
    await resetSink(O.request);
  });
  test.afterAll(async () => { await O.request.dispose(); });

  test('a new embed is live, and the public read says so', async () => {
    const embed = await embedOnFreshCode('new');
    expect(embed.sync_mode).toBe('live');
    expect(await publicSyncMode(O.request, embed.key_id)).toEqual({ status: 200, mode: 'live' });
  });

  test('copy with a hook: the public read says copy and an edit reaches the hook', async () => {
    const embed = await embedOnFreshCode('copy');
    const set = await setEmbedHook(O, embed.id, 'sync-copy');
    expect(set.sync_mode).toBe('copy');
    expect(await publicSyncMode(O.request, embed.key_id)).toEqual({ status: 200, mode: 'copy' });
    await seedWiki(O.request, O.apiToken, O.sid, { title: 'Sync copy note', body: 'x', path: 'sync-copy-note' });
    await arrives('sync-copy', 'wiki://sync-copy-note');
  });

  test('switching to live deletes the hook\'s endpoint', async () => {
    const embed = await embedOnFreshCode('switch');
    const before = await endpointIDs(O);
    await setEmbedHook(O, embed.id, 'sync-switch');
    const live = await setEmbedLive(O, embed.id);
    expect(live.sync_mode).toBe('live');
    expect(await publicSyncMode(O.request, embed.key_id)).toEqual({ status: 200, mode: 'live' });
    // The endpoint list is exactly what it was before the hook was attached.
    expect((await endpointIDs(O)).sort()).toEqual(before.sort());
  });

  test('live with an update hook URL is refused in words', async () => {
    const embed = await embedOnFreshCode('refuse');
    const out = await tryUpdateEmbed(O, { embed_id: embed.id, sync_mode: 'live', update_hook_url: sinkURL('sync-refuse') });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('a live embed has no update hook');
  });

  test('the embed form offers the choice; copy + URL attaches the hook', async ({ adminPage }) => {
    const embed = await embedOnFreshCode('form');
    await gotoAdminSection(adminPage, 'embeds');
    await adminPage.getByTestId(`embed-edit-${embed.id}`).click();
    await expect(adminPage.getByTestId('embed-sync-mode-live')).toBeChecked();
    await adminPage.getByTestId('embed-sync-mode-copy').check();
    await adminPage.getByTestId('embed-update-hook-url').fill(sinkURL('sync-form'));
    await adminPage.getByTestId('embed-save').click();
    await expect(adminPage.getByTestId('embed-update-hook-secret')).toContainText('whsec_');
    expect(await publicSyncMode(O.request, embed.key_id)).toEqual({ status: 200, mode: 'copy' });
    const view = await callTool<HookedEmbed[]>(O.request, O.apiToken, O.sid, 'embeds.list', {});
    expect(view.find((e) => e.id === embed.id)?.update_hook?.url).toBe(sinkURL('sync-form'));
  });
});
