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

// WikiAssetSchema —— 一份挂在这条语料上的文件。**要真实字节数**:下载按钮上写"3.4 MB"
// 是访客决定点不点的依据,写"下载"等于什么都没说。
const WikiAssetSchema = z.object({
  asset_id: z.string(),
  kind: z.string(),
  content_type: z.string(),
  original_filename: z.string(),
  url: z.string(),
  size_bytes: z.number(),
});
export type WikiAsset = z.infer<typeof WikiAssetSchema>;
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
  // asset_urls —— 正文里的 `standmeet-asset:<id>` 引用 + hero 图 → 可访问地址。
  // 没有它，正文里那条 URI 渲不出来（react-markdown 的 urlTransform 会把非标准
  // scheme 直接剥掉），访客看到的是一个空的图位。
  asset_urls: z.record(z.string(), z.string()).nullish().transform((v) => v ?? {}),
  // assets —— 挂在这条上的文件。图片进正文,附件渲成下载区。
  assets: z.array(WikiAssetSchema).nullish().transform((v) => v ?? []),
  // hero 三件套。cover_image_asset_id 为空 = owner 没设封面 → 退回程序生成的色板。
  cover_image_asset_id: z.string().nullish().transform((v) => v ?? ''),
  cover_headline: z.string().nullish().transform((v) => v ?? ''),
  cover_hue: z.string().nullish().transform((v) => v ?? ''),
  // 多语:body 已经是选中语言的那一份。languages 空 = 单语,不出切换器。
  lang: z.string().nullish().transform((v) => v ?? ''),
  languages: z.array(z.object({ code: z.string(), label: z.string() }))
    .nullish().transform((v) => v ?? []),
});
export type WikiLandingEntry = z.infer<typeof WikiLandingEntrySchema>;

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
