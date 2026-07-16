// sync-subjectivity-ingest.spec.ts —— F-L-3.
//
// Real-env verification: 16 subjectivity/ notes in the real vault → 0 imported. Subjectivity is a
// "grounded but not cited by default" private tier — the notes are ordinary raw-form leaves whose
// content is a standpoint, ingested for grounding, never publish-gated (same discipline as raw/).
// But shouldMaterialize only exempted `raw` from the publish gate, so publish-less subjectivity
// leaves were silently SKIPPED and the agent had nothing to ground on.
//
// F-L-8 later removed the ingest gate for EVERY genre (`publish` only sets `published`, the
// anonymous-visibility flag — it never decided corpus membership). So the original "a wiki leaf
// stays gated out" control is void by design: a publish-less wiki leaf now lands too, gated. What
// this spec still pins is F-L-3's own claim — a publish-less subjectivity leaf lands, with
// genre=subjectivity, not silently dropped.

import { test, expect } from '@/fixtures/test';

import { resetInstance } from '@/fixtures/instance';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { claimSyncOwner, syncOwner, syncSession, syncRead } from '@/fixtures/vault-sync';

const OWNER = syncOwner('subjingest');

test.describe('sync · subjectivity leaves ingest without publish (F-L-3)', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claimSyncOwner(request, OWNER);
  });

  test('a publish-less subjectivity leaf is materialized under genre=subjectivity',
    async ({ request }) => {
      const result = await uploadVault(request, OWNER, [
        // no `publish` key — subjectivity must still ingest (private grounding material).
        { rel: 'subjectivity/standpoint.md', body: makeVaultMD({ tags: ['node'] }, 'my standpoint') },
      ]);
      expect(result.errors, 'clean import').toEqual([]);
      expect(result.created, 'the subjectivity leaf ingests without publish (raw-form grounding)')
        .toBeGreaterThanOrEqual(1);
      // It landed as SUBJECTIVITY and is reachable by the agent (the F-L-3 bug dropped it entirely,
      // so there was nothing to ground on). Read via a code session — the private grounding tier is
      // reached by role glob, never by the anonymous `published` gate.
      const read = await syncRead(request, await syncSession(request, OWNER), 'standpoint');
      expect(read.genre, 'the standpoint landed as a subjectivity row').toBe('subjectivity');
      expect(read.body ?? '', 'its content is groundable').toContain('my standpoint');
    });
});
