// sync-subjectivity-ingest.spec.ts —— F-L-3.
//
// Real-env verification: 16 subjectivity/ notes in the real vault → 0 imported. Subjectivity is a
// "grounded but not cited by default" private tier — the notes are ordinary raw-form leaves whose
// content is a standpoint, ingested for grounding, never publish-gated (same discipline as raw/).
// But shouldMaterialize only exempted `raw` from the publish gate, so publish-less subjectivity
// leaves were silently SKIPPED and the agent had nothing to ground on. Existing sync specs cover
// wiki (publish-gated) + raw (always) but never a publish-less subjectivity leaf.

import { test, expect } from '@/fixtures/test';

import { resetInstance } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { claimSyncOwner, syncOwner } from '@/fixtures/vault-sync';

const OWNER = syncOwner('subjingest');

test.describe('sync · subjectivity leaves ingest without publish (F-L-3)', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claimSyncOwner(request, OWNER);
  });

  test('a publish-less subjectivity leaf is materialized; a publish-less wiki leaf is not',
    async ({ request }) => {
      const result = await uploadVault(request, OWNER, [
        // no `publish` key — subjectivity must still ingest (private grounding material)...
        { rel: 'subjectivity/standpoint.md', body: makeVaultMD({ tags: ['node'] }, 'my standpoint') },
        // ...while a publish-less wiki leaf stays gated out (control).
        { rel: 'wiki/draft.md', body: makeVaultMD({ tags: ['node'] }, 'unpublished draft') },
      ]);
      expect(result.errors, 'clean import').toEqual([]);
      expect(result.created, 'the subjectivity leaf ingests without publish (raw-form grounding)')
        .toBeGreaterThanOrEqual(1);
      // Prove the ingested one is the subjectivity note, not the wiki draft: exactly one leaf landed.
      expect(result.skipped, 'the publish-less wiki draft is still skipped').toBeGreaterThanOrEqual(1);
    });
});
