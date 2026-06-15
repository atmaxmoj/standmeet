// AuthShell —— /setup 和 /login 共享的页面外壳。
//
// 视觉对齐 docs/design/project/login.html：
//   - DeployStrip（顶部）: standmeet / self-hosted · v + 部署 host + instance hash
//   - 双列 grid（lg+）: 主表单 + SidePanel "what you get"
//   - Footer: docs / source 链接

'use client';

import type { ReactNode } from 'react';

import { useInstanceHash } from '@/lib/auth/use-instance-hash';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <DeployStrip />
      <main className="flex-1 mx-auto max-w-[1180px] w-full px-6 lg:px-10 py-12 lg:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-12">
          <div>{children}</div>
          <SidePanel />
        </div>
      </main>
      <AuthFooter />
    </div>
  );
}

function DeployStrip() {
  const { hash, host } = useInstanceHash();
  return (
    <div className="border-b border-(--color-rule) px-6 lg:px-10 py-2.5 flex items-center justify-between mono text-[10.5px] tracking-[0.12em]">
      <div className="flex items-baseline gap-3 uppercase">
        <span className="text-(--color-ink)">standmeet</span>
        <span className="text-(--color-faint)">/</span>
        <span className="text-(--color-muted)">self-hosted</span>
        <span className="ml-3 inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-(--color-accent) live-dot" />
          <span className="text-(--color-faint) text-[10px]">v1.0.0</span>
        </span>
      </div>
      <div className="hidden md:flex items-baseline gap-4 text-(--color-faint)">
        <span>deployed at</span>
        <span className="text-(--color-muted)">{host}</span>
        <span>·</span>
        <span>instance</span>
        <span className="text-(--color-muted)">{hash}</span>
      </div>
    </div>
  );
}

function SidePanel() {
  return (
    <aside className="hidden lg:block border-l border-(--color-rule) pl-10">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-4">
        what you get
      </div>
      <ul className="space-y-5">
        {OFFERS.map((row) => <OfferItem key={row.k} row={row} />)}
      </ul>
      <SidePanelTail />
    </aside>
  );
}

type OfferRow = { k: string; t: string; b: string };

const OFFERS: OfferRow[] = [
  { k: '01', t: 'your own corpus', b: 'A self-hosted database that holds every raw dump, every promoted wiki entry, every conversation. You own the instance.' },
  { k: '02', t: 'mcp push endpoint', b: 'Send entries to your corpus from Claude / ChatGPT / Cursor with one client install. No copy-pasting screenshots between tools.' },
  { k: '03', t: 'api tokens', b: 'Generate scoped tokens for AI agents, scripts, or other apps to read or write to your corpus.' },
  { k: '04', t: 'gated chat', b: 'A public surface visitors land on. Codes you issue grant scoped access; BYOAI handles the rest.' },
];

function OfferItem({ row }: { row: OfferRow }) {
  return (
    <li className="grid grid-cols-[28px_1fr] gap-4">
      <span className="mono text-[10.5px] tracking-[0.14em] text-(--color-faint) tabular-nums pt-1.5">{row.k}</span>
      <div>
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-ink) mb-1.5">{row.t}</div>
        <p className="reading text-(--color-muted) text-[14.5px]">{row.b}</p>
      </div>
    </li>
  );
}

function SidePanelTail() {
  return (
    <div className="mt-10 pt-6 border-t border-(--color-rule) mono text-[10px] tracking-[0.04em] leading-[1.7] text-(--color-faint)">
      <p><span className="text-(--color-muted)">data lives on your server.</span> we never see your corpus.</p>
      <p className="mt-1">single-binary install · postgres · mcp · agpl</p>
    </div>
  );
}

function AuthFooter() {
  return (
    <footer className="border-t border-(--color-rule)">
      <div className="max-w-[1180px] mx-auto px-6 lg:px-10 py-7 mono text-[10.5px] tracking-[0.06em] leading-[1.7] text-(--color-muted) flex flex-col md:flex-row md:items-baseline md:justify-between gap-2">
        <div>
          <span className="text-(--color-ink)">standmeet</span>
          <span className="text-(--color-faint) mx-2">·</span>
          <span>self-hosted retrieval for personal corpora</span>
        </div>
        <div className="flex items-baseline gap-4">
          <a className="hover:text-(--color-ink)" href="https://github.com/atmaxmoj/standmeet">docs</a>
          <a className="hover:text-(--color-ink)" href="https://github.com/atmaxmoj/standmeet">source</a>
        </div>
      </div>
    </footer>
  );
}
