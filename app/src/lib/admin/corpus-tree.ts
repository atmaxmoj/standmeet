// corpus-tree.ts —— excerpt helper for the admin corpus lists (shared by every genre). Pure
// logic, lives in lib (the presentation layer doesn't write if/loops).
//
// The tree helpers that used to live here (a client-side forest, a descendant count) worked on
// whatever rows happened to be loaded: past one page they drew children as roots and counted
// "deletes 0 children" for a parent whose child sat on page 2 (F-L-24). Every genre now has the
// server's lazy tree, and every row carries the server's descendant count.

// pickExcerpt —— the SEPARATE authored excerpt if present, else the backend's clean lead
// (`preview`, from LeadLine). Both inputs are already rendered-not-markup, so this never
// hand-strips: a card shows authored prose, a clean lead, or nothing — never source markup.
//
// The old `stripCorpusMeta(body)` fallback is deliberately gone (F-R-1): it stripped only
// frontmatter/headings/backlinks and left `$$`/```` ``` ````/`[[..]]`/`**..**` intact, which is
// exactly how raw markup reached the triage cards. Clean excerpting belongs in ONE place — the
// backend LeadLine — not in a second, weaker frontend stripper.
export function pickExcerpt(excerpt: string, preview: string): string {
  return excerpt.trim() !== '' ? excerpt.trim() : preview.trim();
}
