// scoped-reader —— F-L-11 bearer-aware reader plumbing. The wiki reader page SSR-fetches the landing
// anonymously (published-only, for SEO), so a gated entry an invited viewer IS in scope for comes
// back 404. This re-fetches the landing (and its context) WITH the stored visitor token; the backend
// serves the entry when it's in the code role's corpus glob. Mirrors subscribeScopedChildren (the
// same progressive-enhancement shape for the sub-entries rail). No token / out of scope / bad
// response → null, and the reader keeps the RestrictedDoc it already showed.

import { baseURL, fetchWikiContext } from '@/lib/api/public';
import { loadStoredSession } from '@/lib/gate/use-gate';
import { parseWikiLanding, type WikiLandingEntry } from '@/lib/visitor/wiki-landing';
import type { TreeContext } from '@/lib/corpus/tree';

// 形状和解析住在 `wiki-landing.ts` —— 这个文件 import 了 use-gate(client hook),
// 服务端那条路 import 不得(见那边开头的说明)。
export type { WikiLandingEntry } from '@/lib/visitor/wiki-landing';
export { parseWikiLanding } from '@/lib/visitor/wiki-landing';

export async function fetchWikiLandingScoped(
  slug: string, token: string, lang = '',
): Promise<WikiLandingEntry | null> {
  if (token === '') return null;
  try {
    const q = lang === '' ? '' : `?lang=${encodeURIComponent(lang)}`;
    const res = await fetch(`${baseURL()}/api/v1/wiki/${slug}${q}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (!res.ok) return null;
    return parseWikiLanding(await res.json());
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
  lang = '',
): () => void {
  if (alreadyHave) return () => {};
  const token = loadStoredSession()?.session_token ?? '';
  if (token === '') return () => {};
  let alive = true;
  void Promise.all([fetchWikiLandingScoped(slug, token, lang), fetchWikiContext(slug, token)])
    .then(([entry, ctx]) => {
      if (!alive || entry === null) return;
      onEntry(entry);
      onCtx(ctx);
    });
  return () => { alive = false; };
}
