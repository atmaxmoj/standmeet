// corpus-changed —— **everything** that must invalidate whenever the corpus
// changes lives here.
//
// Why this file exists: the invalidation action used to be **hand-copied**.
// `useCorpusActions.run()` had a line calling `bumpCorpusEpoch()`, and
// quick-dump went through a different path (`use-raw.ts`'s doAddRaw), which
// carried an honest comment next to it — "dump bypasses useCorpusActions —
// bump so the lazy tree refetches" — and then copied that same line. So later,
// when counting invalidation was added to run(), the dump path didn't follow
// along at all: the owner pastes something in, the list gets one more row,
// but the title, the four tabs, the sidebar badge, and the pulse bar all keep
// reporting the old numbers (F-L-16).
//
// The cost of copying it once wasn't that one line at the time — it's that
// **every future addition will miss the second caller**, and nothing will
// error. So only one function lives here: both paths call it, and the next
// thing that needs invalidating gets added in exactly this one place.

import { bumpCorpusEpoch } from '@/lib/admin/corpus-tree-epoch';
import { refreshCorpusGrowth } from '@/lib/admin/use-corpus-growth';

export function onCorpusChanged(): void {
  // Lazy-loaded tree: invalidate the levels already fetched, refetch on expand.
  bumpCorpusEpoch();
  // Counts: /admin/raw's header count, the four tabs, the sidebar badge, and the pulse bar all read this one.
  void refreshCorpusGrowth();
}
