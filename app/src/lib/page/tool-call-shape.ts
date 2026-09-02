// tool-call-shape —— a pure data helper that narrows the tool result wire
// (unknown) into the shape the UI wants. ToolCallCards.tsx is the
// presentation layer, not allowed to do if-statements / type assertions;
// narrowing is done at this layer.

// CardKind —— **legacy** hardcoded card dispatch (serves only capabilities
// not yet externalized; an externalized capability brings its own ui://
// card through sandboxed rendering and doesn't go here). booked
// (calendar_book) has already been externalized into the booker plugin's
// ui:// card; what's left here is the generic debug fallback for
// skill_*/ext_*.
//   - 'dump' → GenericDumpCard (skill_* / ext_* debug box)
//   - 'none' → renders nothing
export type CardKind = 'dump' | 'none';

export function cardKindFor(name: string): CardKind {
  if (name.startsWith('skill_') || name.startsWith('ext_')) return 'dump';
  return 'none';
}

// isRetrievalTool —— the corpus_* retrieval family. These tools **don't**
// each render their own ui:// sandbox card: a real model can retrieve a
// dozen-plus times in one turn, and a per-call card would stack up and
// fill the screen (UX-10). They fold into one RetrievalSummary line
// instead; "what got read" is carried by the citations footer (original
// design: corpus_read never doubly renders a card).
//
// The test is a **prefix**, not a name list. This used to hardcode 4
// names while the backend registers 8 (search/read/list/links/map/
// resolve/peek/grep) —— the 4 added later weren't counted, and
// cardKindFor also returned 'none' for them, so neither branch rendered
// anything, making them completely invisible: in the real environment
// the agent ran 2 searches + 3 greps + 1 read in a turn, and the visitor
// saw `searched 2 · read 1` (F-A-29). A hand-copied name list repeats the
// same mistake **every time** a new retrieval tool is added; a prefix
// doesn't.
const RETRIEVAL_PREFIX = 'corpus_';

export function isRetrievalTool(name: string): boolean {
  return name.startsWith(RETRIEVAL_PREFIX);
}

// ENTRY_READ_TOOLS —— the tools that open a **specific entry's** content.
// peek belongs here: it pulls that note's own material (title/tags/
// subheadings/outlinks/first line), just not the full body — from the
// visitor's point of view that's "looked at this entry", not "searched
// around". The rest (search/list/links/map/resolve/grep) are all asking
// "which entries are relevant".
const ENTRY_READ_TOOLS = new Set(['corpus_read', 'corpus_peek']);

// RetrievalCounts —— retrieval counts after folding.
export interface RetrievalCounts {
  searches: number;
  reads: number;
}

export function retrievalCounts(calls: readonly { name: string }[]): RetrievalCounts {
  let searches = 0;
  let reads = 0;
  for (const c of calls) {
    if (ENTRY_READ_TOOLS.has(c.name)) reads += 1;
    else searches += 1;
  }
  return { searches, reads };
}

// jsonPretty —— debug-grade pretty print for skill/ext results. Falls
// back to stringification (toString) on failure.
export function jsonPretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
