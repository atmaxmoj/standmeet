// markdown-helpers.ts —— chat markdown 的纯 helper，让 .tsx 不带分支。

import type { ReactNode } from 'react';

export function isMermaidCode(className: string): boolean {
  return className.replace(/^language-/, '') === 'mermaid';
}

export function mermaidSource(children: ReactNode): string {
  return typeof children === 'string' ? children
    : Array.isArray(children) ? joinChildArray(children)
    : '';
}

function joinChildArray(children: readonly unknown[]): string {
  return children.map((c) => typeof c === 'string' ? c : '').join('');
}
