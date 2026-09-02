// use-corpus-scope-tree —— the data side of the corpus access picker: **one URI, one real tree**.
//
// Why this exists (F-A-14): granting a role and withdrawing a code both used
// to be a bare textarea, and the owner had to recall the scheme and a note's
// exact **server-side slug** (`subjectivity://cv`) from memory. No
// discoverability, no autocomplete, no validation, and a typo was
// **silent** — a withdrawal silently withheld less, a grant silently
// granted less. The corpus is already a tree; access should be checked off from that tree.
//
// A critical alignment: the URI **must** be the backend's own
// `domain.FormatURI(genre, path)`, and path is slugged server-side
// (`slugJoin`, with SlugifyTitle as the single source). So the picker only
// ever uses the `path` carried on a tree row, and never assembles one from
// the title itself — doing that would be a second slug implementation, bound to drift from the matcher.

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

// ScopeNode —— the picker only needs these four fields; all four genres' trees collapse to this shape.
export const ScopeNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  // path —— the server-slugged address (root→leaf). URI = `${genre}://${path}`.
  path: z.string().nullable().optional(),
  has_children: z.boolean().optional(),
});
export type ScopeNode = z.infer<typeof ScopeNodeSchema>;

// SCOPE_GENRES —— the genres the ACL recognizes. raw is not among them:
// `raw://**` is a hardcoded deny for visitors (MatchesAnyCorpusGlob's first
// line), so giving it a checkbox would only mislead.
export const SCOPE_GENRES = ['wiki', 'output', 'writing', 'subjectivity'] as const;
export type ScopeGenre = typeof SCOPE_GENRES[number];

// treePath —— writing's tree has its own route (it's not in /corpus/{genre}'s dispatch); everything else uses the unified one.
function treePath(genre: ScopeGenre, parentID: string): string {
  const qs = parentID === '' ? '' : `?parent=${encodeURIComponent(parentID)}`;
  return genre === 'writing' ? `/writings/tree${qs}` : `/corpus/${genre}/tree${qs}`;
}

export function loadScopeLayer(genre: ScopeGenre, parentID: string): Promise<ScopeNode[]> {
  return adminAPI.get(treePath(genre, parentID), z.array(ScopeNodeSchema));
}

// uriOf —— the URI this row represents. Byte-for-byte consistent with domain.FormatURI.
export function uriOf(genre: ScopeGenre, node: ScopeNode): string {
  return `${genre}://${node.path ?? ''}`;
}

// subtreeGlobOf —— "this entry **plus everything under it**". In the glob
// dialect, `g://p/**` compiles to `^g://p/.*$`, which does **not** match
// `g://p` itself — so "this entry + its subtree" is inherently two globs,
// not one. Checking a node with children must send both, or the owner will
// think they granted the whole tree while actually missing the folder-note itself.
export function subtreeGlobOf(genre: ScopeGenre, node: ScopeNode): string {
  return `${genre}://${node.path ?? ''}/**`;
}

export function genreGlob(genre: ScopeGenre): string {
  return `${genre}://**`;
}

// globsFor —— checking a row = itself + (when it has children) its entire subtree.
export function globsFor(genre: ScopeGenre, node: ScopeNode): string[] {
  return node.has_children === true
    ? [uriOf(genre, node), subtreeGlobOf(genre, node)]
    : [uriOf(genre, node)];
}

// isTreeExpressible —— **could** this glob have been produced by some
// checkbox. Judged by shape, without pulling the whole tree down:
//   `g://**`      a checkbox for the whole genre
//   `g://a/b`     one row (no wildcard)
//   `g://a/b/**`  that row's subtree
// No other shape (like `wiki://legacy/*/draft`, with a `*` in the middle)
// could ever come from any checkbox, so no checkbox on the tree will light
// up for it — the owner must be told honestly "it's still there, it just
// isn't on the tree", not left thinking it vanished out of nowhere.
//
// Checking the prefix alone isn't enough (the first version of the picker
// did exactly that, so `wiki://legacy/*/draft` was treated as tree-expressible):
// it does start with `wiki://`, but it isn't any row. The judgment lives
// here, not in the component — this is knowledge about the glob dialect, not rendering.
export function isTreeExpressible(glob: string): boolean {
  const genre = SCOPE_GENRES.find((x) => glob.startsWith(`${x}://`));
  const rest = genre === undefined ? '' : glob.slice(`${genre}://`.length);
  const body = rest.endsWith('/**') ? rest.slice(0, -3) : rest;
  return genre !== undefined && (rest === '**' || !body.includes('*'));
}

// foreignGlobs —— the ones in value that the tree can't express (kept as-is, and must be shown to the owner).
export function foreignGlobs(value: readonly string[]): string[] {
  return value.filter((g) => !isTreeExpressible(g));
}
