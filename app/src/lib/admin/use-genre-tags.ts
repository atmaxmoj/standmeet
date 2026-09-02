// use-genre-tags —— **all** tags a genre has ever used (corpus-level), for
// the panel's tag row.
//
// The tag row used to be `distinctTags(rows)` — derived from the page already
// loaded. So a tag that only existed outside that page **didn't even get a
// chip**: it couldn't be clicked, and there was no way to discover it was
// missing. That's exactly how `rate-reduction` disappeared on the real vault,
// and the note carrying it is the very target I need to drive to (the second
// half of F-L-23).
//
// Refetch whenever the corpus changes: shares the corpus epoch with
// pagination, so the tag row never gets stuck on a stale answer after a write.

'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { useCorpusEpoch } from '@/lib/admin/corpus-tree-epoch';

const TagsSchema = z.object({ tags: z.array(z.string()) });

/** All tags for a genre. Falls back to an empty array on failure — a missing tag row beats crashing the whole page. */
export function useGenreTags(genre: string): readonly string[] {
  const epoch = useCorpusEpoch();
  const [tags, setTags] = useState<readonly string[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const resp = await adminAPI.get(`/corpus/${genre}/tags`, TagsSchema);
        if (alive) setTags(resp.tags);
      } catch {
        if (alive) setTags([]);
      }
    })();
    return () => { alive = false; };
  }, [genre, epoch]);
  return tags;
}
