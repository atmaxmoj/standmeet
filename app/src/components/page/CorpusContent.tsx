// CorpusContent —— corpus 正文容器 + owner 自定义 CSS 挂载。
//
// owner CSS 是动态(per-owner、DB 来)的,后端已 sanitize(剥 @import/外部 url/
// expression/js)+ scope(每条选择器加 `.corpus-content` 前缀),并作为**真正的
// stylesheet 资源**在 `/api/v1/appearance.css`(text/css)提供。这里用 <link>
// 引它(而非 inline <style>),再把正文包进 `.corpus-content`(外加 per-note
// `cssclasses` 呈现钩子)。owner 的 Obsidian snippet 就按其定义呈现,做到 vault
// 与 StandMeet 页"两侧长得一模一样"。Next 会 hoist + dedupe 同一 href 的 <link>。

import type { ReactNode } from 'react';

// APPEARANCE_CSS —— 相对路径(浏览器同源;Next rewrites `/api/*` 转后端)。
const APPEARANCE_CSS = '/api/v1/appearance.css';

export function CorpusContent({ classes, children }: {
  classes?: readonly string[];
  children: ReactNode;
}) {
  const cls = ['corpus-content', ...(classes ?? [])].join(' ');
  return (
    <>
      <link rel="stylesheet" href={APPEARANCE_CSS} />
      <div className={cls}>{children}</div>
    </>
  );
}
