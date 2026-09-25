// tool-shape.ts —— facts about tools that every chat surface (the app's main chat and the SDK's
// embedded AgentWidget) must agree on. One definition here; both import it.

// isRetrievalTool —— the corpus_* retrieval family. These tools **don't** each render their own
// ui:// sandbox card: a real model can retrieve a dozen-plus times in one turn, and a per-call card
// would stack up and fill the screen (UX-10). The main chat folds them into one RetrievalSummary
// line; the embedded widget's throbber already says "searching". "What got read" is carried by the
// citations footer.
//
// The test is a **prefix**, not a name list. A hardcoded 4-name list once missed the 4 retrieval
// tools added later (search/read/list/links/map/resolve/peek/grep), making them invisible (F-A-29);
// a hand-copied list repeats that every time a retrieval tool is added, a prefix doesn't. The
// widget once rendered every corpus_search as its own card precisely because this rule lived only
// in the app (prod 2026-09-25).
const RETRIEVAL_PREFIX = 'corpus_';

export function isRetrievalTool(name: string): boolean {
  return name.startsWith(RETRIEVAL_PREFIX);
}
