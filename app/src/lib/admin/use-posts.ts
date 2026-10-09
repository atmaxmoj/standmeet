// use-posts —— the owner's timeline on the admin panel (docs/design/posts.md): corpus genre `post`
// over /corpus/post, newest first, one page at a time. The owner sees every post; who else does is
// each post's `visibility` (+ its role list for `roles`).

'use client';

import { z } from 'zod';

import { onCorpusChanged } from '@/lib/admin/corpus-changed';
import { adminAPI } from '@/lib/api/admin';
import { createPagedStore, usePaged, type PagedState } from '@/lib/state/create-paged-store';

export const VISIBILITIES = ['private', 'public', 'roles'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

// asVisibility —— a <select>'s value back to the union (anything else reads as the safe default).
export function asVisibility(v: string): Visibility {
  return VISIBILITIES.find((x) => x === v) ?? 'private';
}

export const PostViewSchema = z.object({
  id: z.string(),
  body: z.string(),
  visibility: z.enum(VISIBILITIES),
  visible_role_ids: z.array(z.string()).nullish().transform((v) => v ?? []),
  created_at: z.string(),
  updated_at: z.string(),
  asset_urls: z.record(z.string(), z.string()).nullish().transform((v) => v ?? {}),
});
export type PostView = z.infer<typeof PostViewSchema>;

// postsPage —— filter (`visibility`, '' = all) and search (`q`) are params: changing one reloads.
export const postsPage = createPagedStore({
  name: 'posts', path: '/corpus/post', item: PostViewSchema, params: { visibility: '', q: '' },
});

export interface PostInput {
  body: string;
  visibility: Visibility;
  visible_role_ids: string[];
}

export interface PostsHook {
  page: PagedState<PostView>;
  create: (input: PostInput) => Promise<void>;
  setVisibility: (post: PostView, visibility: Visibility) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function usePosts(): PostsHook {
  return { page: usePaged(postsPage), create, setVisibility, remove };
}

// A create or delete re-reads page 1 (the new post leads it); an edit patches the row in place.
async function create(input: PostInput): Promise<void> {
  await adminAPI.post('/corpus/post', input, PostViewSchema);
  onCorpusChanged();
  await postsPage.getState().reload();
}

// setVisibility —— `roles` keeps the post's current role list (the server refuses an empty one).
async function setVisibility(post: PostView, visibility: Visibility): Promise<void> {
  const roleIDs = visibility === 'roles' ? post.visible_role_ids : [];
  const updated = await adminAPI.patch(`/corpus/post/${encodeURIComponent(post.id)}`,
    { visibility, visible_role_ids: roleIDs }, PostViewSchema);
  postsPage.getState().patch(post.id, () => updated);
}

async function remove(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/corpus/post/${encodeURIComponent(id)}`);
  onCorpusChanged();
  await postsPage.getState().reload();
}
