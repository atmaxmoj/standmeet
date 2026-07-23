// markdown-helpers.ts —— chat markdown 的纯 helper，让 .tsx 不带分支。

import type { ReactNode } from 'react';

export function isMermaidCode(className: string): boolean {
  return className.replace(/^language-/, '') === 'mermaid';
}

// escapeCurrencyDollars —— 把"货币 $"(后面直接跟数字的 $)转义成 \$,免得 remark-math
// 把一句话里两个金额之间的文字当行内公式吃掉(#36/#40:"$100 ... $200")。`$E=mc^2$`
// (后跟字母)和 `$$…$$`(display)不动,真行内/块数学照常渲。chat + writing 文章
// 两套 markdown renderer 共用。
export function escapeCurrencyDollars(md: string): string {
  return md.replace(/(?<![\\$])\$(?=\d)/g, '\\$&');
}

// promoteDisplayMath —— Obsidian 把单行 `$$…$$` 当 **display**(块级、居中)数学;remark-math
// v6+ 却把单行 `$$x$$` 当 **inline** → 无 `.katex-display` → 高公式(∑/分式带上下标)与相邻
// 文字行重叠(F-R-3,真 vault `wiki/math/analysis/lagrangian` 全是这种写法)。渲染前把一整行
// (可带 blockquote `>` 前缀)、开头到结尾就是一个 `$$…$$` 的行,提成 fenced 形式(`$$` 各占
// 一行),让 remark-math 走 display 分支。多行 `$$`(`$$` 已各占一行)与行内 `$…$` 都不匹配。
export function promoteDisplayMath(md: string): string {
  return md.replace(
    /^([ \t]*(?:>[ \t]?)*)\$\$(?!\$)(.+?)\$\$[ \t]*$/gm,
    (_m, prefix: string, body: string) => `${prefix}$$\n${prefix}${body.trim()}\n${prefix}$$`,
  );
}

export function mermaidSource(children: ReactNode): string {
  return typeof children === 'string' ? children
    : Array.isArray(children) ? joinChildArray(children)
    : '';
}

function joinChildArray(children: readonly unknown[]): string {
  return children.map((c) => typeof c === 'string' ? c : '').join('');
}
