// corpus-listing —— "which collection the grid holds right now, and where its next page comes from".
//
// This is a **derivation**, not rendering, so it lives at this layer, not in
// the component (the presentation layer must not write branches).
// The two collections look identical but have opposite completeness:
//   - the section's list (a tag is one of its params) → the next page comes from the server;
//   - search → hits across the whole corpus, with **no next page**: letting scrolling
//     to the bottom append the list's next page after the hits would leave the screen
//     unable to tell which rows were actually search results.
// Search takes priority: while there's text in the input, it isn't stacked with the tag
// filter. "Filter by tag" and "search the whole corpus by content" are two different intents,
// and stacking them produces a collection that's neither complete nor accurate.

import type { CorpusSearchHook } from '@/lib/admin/use-corpus-search';
import type { CorpusView } from '@/lib/admin/corpus-view';
import type { PagedState } from '@/lib/state/create-paged-store';

// GridMore —— whether the grid has a next page, and how to ask for it.
export interface GridMore {
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

const NO_MORE: GridMore = { hasMore: false, loadMore: () => Promise.resolve() };

export interface CorpusListing<Row> {
  rows: readonly Row[];
  view: CorpusView;
  more: GridMore;
}

export function corpusListing<Row>(input: {
  search: CorpusSearchHook;
  searchRows: readonly Row[];
  page: PagedState<Row>;
  view: CorpusView;
}): CorpusListing<Row> {
  return input.search.active
    ? { rows: input.searchRows, view: 'grid', more: NO_MORE }
    : { rows: input.page.items, view: input.view, more: input.page };
}

// loadMoreIfNearEnd —— pull the next page when the last visible virtual row is within two
// rows of the end. Kept in lib so the grid component stays branch-free.
export function loadMoreIfNearEnd(lastIndex: number | undefined, rowCount: number, more: GridMore): void {
  if (lastIndex !== undefined && lastIndex >= rowCount - 2 && more.hasMore) void more.loadMore();
}
