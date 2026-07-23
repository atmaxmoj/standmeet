// scoped-reader —— F-L-11 bearer-aware reader plumbing. The wiki reader page SSR-fetches the landing
// anonymously (published-only, for SEO), so a gated entry an invited viewer IS in scope for comes
// back 404. This re-fetches the landing (and its context) WITH the stored visitor token; the backend
// serves the entry when it's in the code role's corpus glob. Mirrors subscribeScopedChildren (the
// same progressive-enhancement shape for the sub-entries rail). No token / out of scope / bad
// response → null, and the reader keeps the RestrictedDoc it already showed.

import { z } from 'zod';

import { baseURL, fetchWikiContext } from '@/lib/api/public';
import { loadStoredSession } from '@/lib/gate/use-gate';
import type { TreeContext } from '@/lib/corpus/tree';

const WikiRefViewSchema = z.object({ path: z.string(), title: z.string() });
const WikiLandingEntrySchema = z.object({
  path: z.string(),
  title: z.string(),
  body: z.string(),
  excerpt: z.string(),
  updated_at: z.string(),
  tags: z.array(z.string()).nullish().transform((v) => v ?? []),
  css_classes: z.array(z.string()).nullish().transform((v) => v ?? []),
  related: z.array(WikiRefViewSchema).nullish().transform((v) => v ?? []),
  cited_by: z.array(WikiRefViewSchema).nullish().transform((v) => v ?? []),
  sources_count: z.number(),
});
export type WikiLandingEntry = z.infer<typeof WikiLandingEntrySchema>;

export async function fetchWikiLandingScoped(
  slug: string, token: string,
): Promise<WikiLandingEntry | null> {
  if (token === '') return null;
  try {
    const res = await fetch(`${baseURL()}/api/v1/wiki/${slug}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (!res.ok) return null;
    const parsed = WikiLandingEntrySchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// loadScopedLanding —— on mount, when SSR did NOT already serve the entry (alreadyHave=false) and a
// visitor token exists, re-fetch the landing + context with the token and hand both back. Returns a
// cleanup that cancels the in-flight update (component unmount / slug change). No token → no-op.
export function loadScopedLanding(
  slug: string,
  alreadyHave: boolean,
  onEntry: (e: WikiLandingEntry) => void,
  onCtx: (c: TreeContext) => void,
): () => void {
  if (alreadyHave) return () => {};
  const token = loadStoredSession()?.session_token ?? '';
  if (token === '') return () => {};
  let alive = true;
  void Promise.all([fetchWikiLandingScoped(slug, token), fetchWikiContext(slug, token)])
    .then(([entry, ctx]) => {
      if (!alive || entry === null) return;
      onEntry(entry);
      onCtx(ctx);
    });
  return () => { alive = false; };
}
