// AuthShell —— /setup 和 /login 共享的页面外壳：deploy strip + 主区域 + 脚注。
//
// 视觉对齐 docs/design/project/login.html 的 DeployStrip + 主 grid。

import type { ReactNode } from 'react';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <DeployStrip />
      <main className="flex-1 mx-auto max-w-[1180px] w-full px-6 lg:px-10 py-12 lg:py-16">
        {children}
      </main>
      <AuthFooter />
    </div>
  );
}

function DeployStrip() {
  return (
    <div className="border-b border-(--color-rule) px-6 lg:px-10 py-2.5 flex items-center justify-between mono text-[10.5px] tracking-[0.12em]">
      <div className="flex items-baseline gap-3 uppercase">
        <span>standmeet</span>
        <span className="text-(--color-faint)">/</span>
        <span className="text-(--color-muted)">self-hosted</span>
      </div>
      <div className="text-(--color-faint)">single-binary · sqlite · mcp</div>
    </div>
  );
}

function AuthFooter() {
  return (
    <footer className="border-t border-(--color-rule)">
      <div className="max-w-[1180px] mx-auto px-6 lg:px-10 py-7 mono text-[10.5px] tracking-[0.06em] text-(--color-muted)">
        <span>standmeet</span>
        <span className="text-(--color-faint) mx-2">·</span>
        <span>self-hosted retrieval for personal corpora</span>
      </div>
    </footer>
  );
}
