// content-lang.ts — which side of a multilingual note to show. `?lang=` (a link to one side, the
// note's own language switch) wins; otherwise the visitor's interface language, so a Chinese
// interface no longer opens an English body (owner 2026-10-04: "有时候我看见中文，有时候我看见英文").
// A note without that language falls back to its own (the backend's select).

import { getLocale } from 'next-intl/server';

export async function wantedContentLang(search: { lang?: string }): Promise<string> {
  if (search.lang !== undefined) return search.lang;
  const ui = await getLocale();
  // Notes are written in base languages (en / zh); the Hong Kong interface reads the Chinese side.
  return ui.startsWith('zh') ? 'zh' : ui;
}
