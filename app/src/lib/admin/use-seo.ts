// use-seo —— /admin/seo 站点 SEO 设置 + indexing stats（#102，真后端）。
//
//   GET  /seo        → { site_title, og_template, sitemap_extras, index_robots }
//   PUT  /seo        → 存（site_title 是 owner 自写的；og:description / canonical
//                      不在此——分别复用 page 的 hero prose（hero_prose）/ owner.public_url）
//   GET  /seo/stats  → { wiki, outputs, writings } 各 tier 已 published 计数；
//                      owner 在 UI 选统计范围（默认全含），求和在组件侧。
//
// 写失败 throw（组件用 useAction 决定 toast），从不吞。载入失败落 error 态，
// 组件用 useEffectErrorToast 反显。

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const SEOSettingsSchema = z.object({
  site_title: z.string(),
  og_template: z.string(),
  sitemap_extras: z.array(z.string()),
  index_robots: z.boolean(),
});
export type SEOSettings = z.infer<typeof SEOSettingsSchema>;

const SEOStatsSchema = z.object({
  wiki: z.number(),
  outputs: z.number(),
  writings: z.number(),
});
export type SEOStats = z.infer<typeof SEOStatsSchema>;

export interface SEOHook {
  settings: SEOSettings | null;
  stats: SEOStats | null;
  loading: boolean;
  error: string | null;
  save: (next: SEOSettings) => Promise<void>;
}

export function useSEO(): SEOHook {
  const [settings, setSettings] = useState<SEOSettings | null>(null);
  const [stats, setStats] = useState<SEOStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadSEO()
      .then((r) => alive && applyLoaded(r, setSettings, setStats))
      .catch((e: unknown) => alive && setError(errText(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const save = useCallback(async (next: SEOSettings): Promise<void> => {
    setSettings(await adminAPI.put('/seo', next, SEOSettingsSchema));
  }, []);

  return { settings, stats, loading, error, save };
}

async function loadSEO(): Promise<{ settings: SEOSettings; stats: SEOStats }> {
  const [settings, stats] = await Promise.all([
    adminAPI.get('/seo', SEOSettingsSchema),
    adminAPI.get('/seo/stats', SEOStatsSchema),
  ]);
  return { settings, stats };
}

function applyLoaded(
  r: { settings: SEOSettings; stats: SEOStats },
  setSettings: (s: SEOSettings) => void,
  setStats: (s: SEOStats) => void,
): void {
  setSettings(r.settings);
  setStats(r.stats);
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'Failed to load SEO settings.';
}
