// post-slug-index — the (slug, title) index used by the writings editor's
// `[[crosslink]]` autocomplete. Fetches all of the owner's writings
// (including drafts); the caller does the filtering by query.

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

export interface PostSlugEntry {
  slug: string;
  title: string;
}

const AdminPostRowSchema = z.array(z.object({ slug: z.string(), title: z.string() }));

const ENDPOINT = '/api/admin/writings/';

export async function fetchAdminPostSlugs(): Promise<PostSlugEntry[]> {
  const res = await fetch(ENDPOINT, { credentials: 'include' });
  if (!res.ok) throw new Error(`list admin writings: ${res.status}`);
  const rows = await safeJson(res, AdminPostRowSchema);
  return rows.map((r) => ({ slug: r.slug, title: r.title }));
}

export function filterSlugs(
  entries: readonly PostSlugEntry[], query: string,
): PostSlugEntry[] {
  const q = query.toLowerCase();
  const match = q === ''
    ? entries.slice()
    : entries.filter((e) => entryMatches(e, q));
  return match.slice(0, 12);
}

function entryMatches(entry: PostSlugEntry, q: string): boolean {
  return entry.slug.toLowerCase().includes(q)
    || entry.title.toLowerCase().includes(q);
}
