// href.ts —— **the address of one piece of corpus on the public site, computed only here.**
//
// Why this module exists: this used to have no single owner — 15 places each
// built their own address inline, and they **disagreed with each other**:
//   - `/writings/${writing.slug}`  ← WritingCards ×3 / WritingsIndex / WritingArticle
//   - `/writings/${node.path}`     ← WritingTreeAside / writings/[slug]/page.tsx
//   - `/wiki/${node.path}`         ← 7 places
//   - `/${c.genre}/${c.path}`      ← two citation links
//
// The last form rendered a 404 in prod: `sijie.xyz/writing/writings/the-business-model-wedge`.
// It **treated the genre name as the route name** — the genre is the singular
// `writing`, but the route is the plural `/writings/[slug]`; and that writing's
// corpus path already carries a `writings/` prefix (the vault has that directory),
// so the two stacked into a doubled segment.
//
// The deeper layer is `mapWritingNode` in `public.ts`: it stuffed `slug` into
// the `path` field (the comment there literally says "slug goes in path").
// So the same `TreeNode.path` means slug from the tree endpoint and the real
// path from the citation result — **one field name, two meanings** — and that
// is exactly why the same expression was correct on one screen and 404'd on
// another ([[names-that-lie]]). Renaming things made the independent decisions
// at each call site *look* consistent, when they never actually were.
//
// So what lives here isn't one string concatenation, it's two decisions:
//   ① which route segment each genre maps to (the writing → writings
//      singular/plural mismatch has already been solved in place a third time
//      elsewhere, see `genre === 'writing' ? …` in `use-corpus-scope-tree.ts`)
//   ② which **identifier** each genre addresses by: writings use slug,
//      wiki / output use the tree path
//
// The `check-one-corpus-href` gate only allows these three prefixes to leave this file.

// CorpusGenre —— the three genres that are **addressable** on the public site.
// raw / subjectivity have no public pages, so they're not here — this union
// type itself is the list of "what has an address".
export type CorpusGenre = 'wiki' | 'output' | 'writing';

// ROUTE_SEGMENT —— genre → route segment. **Only writing differs**, and that's
// exactly what let `/${genre}/…` accidentally work for two genres while
// 404ing on the third.
const ROUTE_SEGMENT: Readonly<Record<CorpusGenre, string>> = {
  wiki: 'wiki',
  output: 'output',
  writing: 'writings',
};

// CorpusRef —— the **address credential** for one piece of corpus.
//
// The two identifiers are kept separate, not merged into a single `path`:
// wiki / output address by tree path (multi-segment, `/wiki/a/b/c`), writings
// address by slug (single segment). The moment they get merged, someone has
// to rename something at some boundary — and that rename is exactly where
// this bug came from. When a caller can't produce the identifier its genre
// needs, this returns an empty string instead of guessing one — a link that
// points nowhere is worse than no link: it looks clickable and 404s on click.
export type CorpusRef =
  | { genre: 'wiki' | 'output'; path: string }
  | { genre: 'writing'; slug: string };

// corpusHref —— the address of this corpus item on the public site. Empty identifier → empty string (caller uses this to skip rendering the link).
export function corpusHref(ref: CorpusRef): string {
  const id = ref.genre === 'writing' ? ref.slug : ref.path;
  return id === '' ? '' : `/${ROUTE_SEGMENT[ref.genre]}/${stripLeadingSlash(id)}`;
}

function stripLeadingSlash(s: string): string {
  return s.startsWith('/') ? s.slice(1) : s;
}

// citationHref —— the address for a citation shown under an answer.
//
// A citation row carries both a path (the human-readable location) and a
// slug (the writings address); **picking which one to use is this
// function's job**, not the rendering side's — it used to be a `/${genre}/${path}`
// line on the rendering side, copy-pasted twice, and wrong both times.
export function citationHref(c: { genre: CorpusGenre; path: string; slug: string }): string {
  return c.genre === 'writing'
    ? corpusHref({ genre: 'writing', slug: c.slug })
    : corpusHref({ genre: c.genre, path: c.path });
}
