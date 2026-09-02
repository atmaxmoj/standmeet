// corpus-listing —— "which collection the grid holds right now, and where it paginates from".
//
// This is a **derivation**, not rendering, so it lives at this layer, not in
// the component (the presentation layer must not write branches).
// The two collections look identical but have opposite completeness:
//   - tag filter → a subset of this page, pagination asks the server for the next page (with the tag) via `gridSource`;
//   - search     → hits across the whole corpus, **gridSource is withheld** —
//     that's the source pagination reads from; supplying it would let
//     scrolling to the bottom append the tag page's next page after the hits,
//     and the screen could no longer tell which were actually search results.
// Search takes priority: while there's text in the input, it isn't
// stacked with the tag filter. "Filter this page by tag" and "search the
// whole corpus by content" are two different intents, and stacking them
// produces a collection that's neither complete nor accurate.

import type { z } from 'zod';

import type { CorpusSearchHook } from '@/lib/admin/use-corpus-search';
import type { CorpusView } from '@/lib/admin/corpus-view';

// The schema follows the row type: the grid uses it to parse **the next
// page's rows**, and the two must be the same type — otherwise "what came
// back" and "what's already on screen" could be two different shapes and nothing would error.
export interface CorpusGridSource<Row> {
  pagePath: string;
  schema: z.ZodType<Row>;
}

export interface CorpusListing<Row> {
  rows: readonly Row[];
  view: CorpusView;
  /** Spread into `<CorpusTreeGrid {...}>`: while searching this is an empty object, so the grid shows only the hit set. */
  gridProps: { gridSource?: CorpusGridSource<Row> };
}

/**
 * filterByTag —— only for the **tree** view: the tree is a lazily-loaded
 * hierarchy, one level at a time, and here a tag means "filter this level".
 * The grid view does **not** go through this — it's a paginated view, and
 * filtering must be pushed down to the page-fetch step (`taggedPagePath`),
 * otherwise it would only filter the page already loaded, and the panel
 * would present the result as the answer for the whole corpus
 * (F-L-23: 137 math entries displayed as 1).
 */
export function filterByTag<Row extends { tags: readonly string[] }>(
  rows: readonly Row[], tag: string | null,
): readonly Row[] {
  return tag === null ? rows : rows.filter((r) => r.tags.includes(tag));
}

/**
 * taggedPagePath —— carries the selected tag into the pagination address.
 * The pagination source is no longer shut off just because a tag was
 * selected: shutting it off is exactly what caused F-L-23.
 */
export function taggedPagePath(base: string, tag: string | null): string {
  return tag === null ? base : `${base}?tag=${encodeURIComponent(tag)}`;
}

export function corpusListing<Row>(input: {
  search: CorpusSearchHook;
  searchRows: readonly Row[];
  tagRows: readonly Row[];
  view: CorpusView;
  gridSource: CorpusGridSource<Row>;
}): CorpusListing<Row> {
  return input.search.active
    ? { rows: input.searchRows, view: 'grid', gridProps: {} }
    : { rows: input.tagRows, view: input.view, gridProps: { gridSource: input.gridSource } };
}
