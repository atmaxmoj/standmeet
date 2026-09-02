// tree.ts —— genre-neutral tree node shape, shared by the LazyTree component
// and every corpus tree data source (wiki / output / writing). One layer at a
// time (lazy loading): has_children decides whether to draw the expand arrow,
// and the next layer is only fetched on expand. Matches the node shape of the
// backend's GET /api/v1/wiki-tree; path uses the same convention as landing (tree-derived).

import { z } from 'zod';

export const TreeNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  // path —— stable key for navigation + testid. wiki = tree-derived path;
  // writing = slug (a writing's "path" IS its slug; landing is /writings/<slug>).
  //
  // ⚠️ **This field means something different per genre**, so don't build an
  // address out of it yourself. One name holding two meanings once made
  // `/${genre}/${path}` correct for wiki and a 404 for writing
  // (`/writing/writings/<slug>`, the one public writing citation in prod that hit it).
  // For an address, go through `corpusHref` in `lib/corpus/href.ts` — which
  // identifier each genre uses is written only there, and the
  // `check-one-corpus-href` gate forbids building one anywhere else.
  path: z.string(),
  has_children: z.boolean(),
  // locked —— a writing's private node (teaser only). Absent for wiki, optional.
  locked: z.boolean().optional(),
});

export type TreeNode = z.infer<typeof TreeNodeSchema>;

export const TreeResponseSchema = z.object({ nodes: z.array(TreeNodeSchema) });

// TreeContext —— a node's breadcrumb ancestor chain (root→parent) plus its direct children (sub-rail).
export const TreeContextSchema = z.object({
  ancestors: z.array(TreeNodeSchema),
  children: z.array(TreeNodeSchema),
});

export type TreeContext = z.infer<typeof TreeContextSchema>;

export const EMPTY_TREE_CONTEXT: TreeContext = { ancestors: [], children: [] };

// TreeLoader —— LazyTree's data interface: given a parentId (''=roots), returns that layer's direct children.
export type TreeLoader = (parentId: string) => Promise<TreeNode[]>;
