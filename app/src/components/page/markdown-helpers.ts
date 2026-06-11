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

export function mermaidSource(children: ReactNode): string {
  return typeof children === 'string' ? children
    : Array.isArray(children) ? joinChildArray(children)
    : '';
}

function joinChildArray(children: readonly unknown[]): string {
  return children.map((c) => typeof c === 'string' ? c : '').join('');
}
