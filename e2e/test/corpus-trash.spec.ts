// corpus-trash.spec.ts —— a deleted corpus entry goes to the trash, not into the void.
//
// Before: corpus.delete was a hard DELETE. The owner's AI holds a key that can delete (the
// "destructive" scope), and one wrong call — or one vault sync that pruned the wrong set — lost
// the entry, its whole subtree (parent_id cascades) and every [[link]] edge to it, with no way back.
//
// Now: the entry and everything that went with it wait in the trash for TRASH_DAYS; corpus.restore
// puts back the same ids, the same tree and the same link edges; a daily job purges what is older.
//
// Black box through the owner's MCP face. The one non-API step is the purge test winding a trash
// row's clock back (execSQL) — there is no "pretend a month passed" endpoint, nor should there be.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'trash-owner@example.com', password: 'correct-horse-battery-staple',
  handle: 'trashowner', fullName: 'Trash Owner',
};

const TRASH_DAYS = 90;

interface Created { id: string }
interface TrashItem {
  id: string; genre: string; title: string;
  deleted_at: string; purge_at: string; descendants: number;
}
interface TrashList { items: TrashItem[] }

let request: APIRequestContext;
let token = '';
let sid = '';

function tool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return callTool<T>(request, token, sid, name, args);
}

async function wiki(title: string, body: string, parentID = ''): Promise<string> {
  const c = await tool<Created>('corpus.create', { genre: 'wiki', title, body, parent_id: parentID });
  return c.id;
}

async function trash(): Promise<TrashItem[]> {
  return (await tool<TrashList>('corpus.trash', {})).items;
}

// backlinksOf —— the entry's backlinks as corpus.get reports them, as one string to search.
async function backlinksOf(id: string): Promise<string> {
  const got = await tool<{ backlinks?: unknown[] }>('corpus.get', { genre: 'wiki', id });
  return JSON.stringify(got.backlinks ?? []);
}

test.describe('corpus · delete goes to the trash; restore brings back the subtree and its links', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    token = await createAPIToken(request, csrf, 'trash-spec');
    sid = await initMCP(request, token);
  });

  test.afterAll(async () => { await request.dispose(); });

  test('deleting a parent trashes it with its child; restore returns both, ids and links intact',
    async () => {
      const parent = await wiki('Trashable Parent', 'The parent body.');
      const child = await wiki('Trashable Child', 'The child body.', parent);
      await wiki('Trash Linker', 'See [[Trashable Child]] for the details.');
      expect(await backlinksOf(child), 'the backlink exists before the delete')
        .toContain('Trash Linker');

      await tool('corpus.delete', { genre: 'wiki', id: parent });

      await expect(tool('corpus.get', { genre: 'wiki', id: child }),
        'the child went with its parent').rejects.toThrow(/not found/i);
      const items = await trash();
      expect(items.map((i) => i.title), 'the trash lists the deleted root once').toEqual(['Trashable Parent']);
      const [root] = items;
      expect(root?.id).toBe(parent);
      expect(root?.genre).toBe('wiki');
      expect(root?.descendants, 'the child is counted under its root').toBe(1);
      const kept = Date.parse(root?.purge_at ?? '') - Date.parse(root?.deleted_at ?? '');
      expect(Math.round(kept / 86_400_000), 'purge date = deleted + the retention window').toBe(TRASH_DAYS);

      const restored = await tool<{ restored: string[] }>('corpus.restore', { id: parent });
      expect(restored.restored.sort(), 'both rows come back under their old ids').toEqual([parent, child].sort());

      const back = await tool<{ parent_id?: string; body: string }>('corpus.get', { genre: 'wiki', id: child });
      expect(back.parent_id, 'the child is under its parent again').toBe(parent);
      expect(back.body).toBe('The child body.');
      expect(await backlinksOf(child), 'the backlink edge is back without re-saving the linker')
        .toContain('Trash Linker');
      expect(await trash(), 'a restored entry leaves the trash').toEqual([]);
    });

  test('restoring a child whose parent is also in the trash says to restore the parent first',
    async () => {
      const parent = await wiki('Second Parent', 'p');
      const child = await wiki('Second Child', 'c', parent);
      await tool('corpus.delete', { genre: 'wiki', id: child });
      await tool('corpus.delete', { genre: 'wiki', id: parent });
      expect((await trash()).map((i) => i.title).sort()).toEqual(['Second Child', 'Second Parent']);

      await expect(tool('corpus.restore', { id: child }),
        'the error names the parent to restore first').rejects.toThrow(/Second Parent/);

      await tool('corpus.restore', { id: parent });
      await tool('corpus.restore', { id: child });
      const back = await tool<{ parent_id?: string }>('corpus.get', { genre: 'wiki', id: child });
      expect(back.parent_id).toBe(parent);
    });

  test(`the purge job drops what has been in the trash longer than ${TRASH_DAYS} days`, async () => {
    const old = await wiki('Old Trash', 'old');
    const fresh = await wiki('Fresh Trash', 'fresh');
    await tool('corpus.delete', { genre: 'wiki', id: old });
    await tool('corpus.delete', { genre: 'wiki', id: fresh });
    execSQL(`UPDATE corpus_trash SET deleted_at = now() - interval '${TRASH_DAYS + 1} days'
             WHERE note_id = '${old}'`);

    await tool('tasks.run_periodic', { name: 'corpus trash purge' });

    await expect.poll(async () => (await trash()).map((i) => i.title), { timeout: 30_000 })
      .toEqual(['Fresh Trash']);
    await expect(tool('corpus.restore', { id: old }), 'a purged entry is gone for good')
      .rejects.toThrow(/not in the trash/i);
  });
});
