// mcp-obsidian-sync-dir.spec.ts — obsidian.import accepts a DIRECTORY, not just a files[] array.
//
// The backend op takes files=[{path,content}] because a remote server can't read the caller's disk;
// the admin folder-upload leans on the *browser* to read the picked folder. That left the MCP twin
// unusable for an AI client, which can't materialize a whole vault into one tool call — so it was
// not a real twin. The fix lives in the @standmeet/mcp-client bridge, which DOES run on the owner's
// machine: an obsidian.import call carrying a `path` (the vault root) is expanded there into the
// files the backend expects, so `obsidian.import({ path })` is a real twin of picking the folder.
//
// Real end-to-end: spawn the ACTUAL SDK bridge over stdio (the same one Claude Desktop / Cursor
// spawn), hand it the PATH to a temp vault on disk — nothing is fed to obsidian.import but that path
// — and read the notes back through corpus.search. A hit proves the whole chain: bridge reads the
// dir → files → SyncIngester → corpus store → search index. raw notes are used because raw
// materializes unconditionally (wiki is publish-gated), keeping the test about the dir-read path.

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect } from '@/fixtures/test';

import { login as loginAPI, claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createKeypair } from '@/fixtures/keypair';
import { spawnStdioMCP } from '@/fixtures/mcp-stdio';

const OWNER = {
  email: 'mcp-sync-dir@example.com', password: 'correct-horse-battery-staple',
  handle: 'mcpsyncdir', fullName: 'MCP Sync Dir Owner',
};

interface ToolResult { content?: Array<{ type: string; text?: string }>; isError?: boolean }
interface SyncResult { created: number; updated: number; skipped: number; deleted: number }

test.describe('owner MCP obsidian.import accepts a directory (the real twin)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('obsidian.import({ path }) reads a temp vault dir and lands its notes, retrievable by content',
    async ({ playwright }) => {
      // A temp vault on disk: two raw notes (one nested) under the genre top-folder, plus a .obsidian
      // dot-dir the bridge must walk past without choking or uploading.
      const vault = await mkdtemp(join(tmpdir(), 'sm-vault-'));
      const markerA = 'dirsyncprobeworda';
      const markerB = 'dirsyncprobewordb';
      await mkdir(join(vault, 'raw', 'nested'), { recursive: true });
      await writeFile(join(vault, 'raw', 'note-a.md'), `Raw note A carrying ${markerA} as its term.`);
      await writeFile(join(vault, 'raw', 'nested', 'note-b.md'), `Raw note B carrying ${markerB}.`);
      await mkdir(join(vault, '.obsidian'), { recursive: true });
      await writeFile(join(vault, '.obsidian', 'workspace.json'), '{"skip":"me"}');

      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const kp = await createKeypair(request, csrf, 'dir-sync-laptop');
      await request.dispose();

      const client = await spawnStdioMCP({ keyId: kp.key_id, privateKeyPem: kp.private_key_pem });
      try {
        // Hand the bridge a PATH, not files. The bridge (running on this machine) reads the dir.
        const syncRaw = await client.call('tools/call', {
          name: 'obsidian.import', arguments: { path: vault },
        }, 1) as ToolResult;
        expect(syncRaw.isError ?? false, 'the directory sync did not error').toBe(false);
        const sync = JSON.parse(syncRaw.content?.[0]?.text ?? '{}') as SyncResult;
        expect(sync.created, 'both markdown notes in the dir were created').toBeGreaterThanOrEqual(2);

        // Proof is retrieval: search for each marker the FILES ON DISK carried. Nothing was handed to
        // obsidian.import but the directory path, so a hit means the bridge really read the folder.
        for (const marker of [markerA, markerB]) {
          const found = await client.call('tools/call', {
            name: 'corpus.search', arguments: { genre: 'raw', query: marker },
          }, 2) as ToolResult;
          const hits = JSON.parse(found.content?.[0]?.text ?? '[]') as unknown[];
          expect(hits.length, `the note carrying ${marker} synced from disk is retrievable`)
            .toBeGreaterThanOrEqual(1);
          expect(JSON.stringify(hits), `the retrieved note carries ${marker}`).toContain(marker);
        }
      } finally {
        client.close();
        await rm(vault, { recursive: true, force: true });
      }
    });
});
