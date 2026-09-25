// tool-call-shape —— a pure data helper that narrows the tool result wire
// (unknown) into the shape the UI wants. ToolCallCards.tsx is the
// presentation layer, not allowed to do if-statements / type assertions;
// narrowing is done at this layer.

// CardKind —— **legacy** hardcoded card dispatch (serves only blocks
// not yet externalized; an externalized block brings its own ui://
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

// isRetrievalTool (which tools fold into the retrieval summary) lives in @standmeet/sdk-core:
// the embedded widget needs the same rule.

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
