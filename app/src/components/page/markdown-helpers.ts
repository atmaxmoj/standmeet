// markdown-helpers.ts —— chat markdown 的纯 helper，让 .tsx 不带分支。

import type { ReactNode } from 'react';

export function isMermaidCode(className: string): boolean {
  return className.replace(/^language-/, '') === 'mermaid';
}

// escapeCurrencyDollars —— 把"货币 $"转义成 \$,免得 remark-math 把一句话里两个金额之间的
// 文字当行内公式吃掉(#36/#40:"$100 ... $200")。
//
// **判据是配对,不是"后面跟没跟数字"。** 上一版的规则就是后者(`\$(?=\d)`),于是每一个
// 以数字开头的行内公式都被它转义掉 —— `$0<h_1<h_2$` 里开头那个 `$` 死了,它的收尾 `$` 就
// 变成了下一段的开头,整段的配对从此错位:访客在一段证明中间读到成片的 `\varphi`、`\le`
// 和 `$`,周围的词还被粘成 `dividingby`(F-R-4,真 vault 笔记 adaptive-commitment-value)。
// 一条为某一类写的规则,悄悄吃掉了紧挨着的另一类,而且坏的不只是那一处,是那一段的其余部分。
//
// 现在的规则:一个后面跟数字的 `$`,只有在**同一行里找不到能给它收尾的 `$`** 时才算货币。
// 能收尾 = 那个 `$` 前面不是空白(remark-math 自己的收尾条件),且后面不是字母数字
// (否则它是下一个金额的 `$`)。于是:
//   "$100 up front and $200"  → 候选收尾前面是空格 → 不成对 → 两个都是货币 ✓
//   "$0<h_1<h_2$, $t=…$"      → 收尾前面是 `2`、后面是 `,` → 成对 → 是公式,不动 ✓
export function escapeCurrencyDollars(md: string): string {
  return md.replace(
    /(?<![\\$])\$(?=\d)/g,
    (m: string, offset: number, whole: string) =>
      hasInlineCloser(whole, offset) ? m : `\\${m}`,
  );
}

// hasInlineCloser —— openAt 处的 `$` 在同一行里有没有一个能当收尾的 `$`。
function hasInlineCloser(text: string, openAt: number): boolean {
  const lineEnd = lineEndFrom(text, openAt);
  for (let i = openAt + 1; i < lineEnd; i += 1) {
    if (text[i] === '$' && closesMath(text, i)) return true;
  }
  return false;
}

// closesMath —— 前面不是空白(remark-math 的收尾条件),后面不是字母数字
// (紧跟着字母数字的 `$` 是下一段的开头,不是这一段的收尾)。
function closesMath(text: string, at: number): boolean {
  const before = text[at - 1] ?? ' ';
  const after = text[at + 1] ?? ' ';
  return !/\s/.test(before) && !/[0-9A-Za-z]/.test(after);
}

function lineEndFrom(text: string, from: number): number {
  const at = text.indexOf('\n', from);
  return at === -1 ? text.length : at;
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
