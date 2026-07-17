// AuthShell —— /setup 和 /login 共享的页面外壳。
//
// 视觉对齐 docs/design/project/login.html：
//   - DeployStrip（顶部）: standmeet / self-hosted · v + 部署 host + instance hash
//   - 双列 grid（lg+）: 主表单 + SidePanel "what you get"
//   - Footer: docs / source 链接

'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { useInstanceHash } from '@/lib/auth/use-instance-hash';

// showOffers —— the "what you get" pitch belongs on /setup (owner deciding to
// claim a fresh instance), not /login (a returning owner who already deployed —
// the pitch is redundant there). Login passes false → single-column form.
export function AuthShell({
  children,
  showOffers = true,
}: {
  children: ReactNode;
  showOffers?: boolean;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <DeployStrip />
      <main className="flex-1 mx-auto max-w-[1180px] w-full px-6 lg:px-10 py-12 lg:py-16">
        <ShellBody showOffers={showOffers}>{children}</ShellBody>
      </main>
      <AuthFooter />
    </div>
  );
}

function ShellBody({ children, showOffers }: { children: ReactNode; showOffers: boolean }) {
  const layout = showOffers
    ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-12'
    : 'max-w-[560px]';
  return (
    <div className={layout}>
      <div>{children}</div>
      {showOffers ? <SidePanel /> : null}
    </div>
  );
}

function DeployStrip() {
  const { hash, host } = useInstanceHash();
  const t = useTranslations('auth.shell');
  return (
    <div className="border-b border-(--color-rule) px-6 lg:px-10 py-2.5 flex items-center justify-between mono text-[10.5px] tracking-[0.12em]">
      <div className="flex items-baseline gap-3 uppercase">
        <span className="text-(--color-ink)">{t('brand')}</span>
        <span className="text-(--color-faint)">/</span>
        <span className="text-(--color-muted)">{t('selfHosted')}</span>
        <span className="ml-3 inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-(--color-accent) live-dot" />
          <span className="text-(--color-faint) text-[10px]">{t('version')}</span>
        </span>
      </div>
      <div className="hidden md:flex items-baseline gap-4 text-(--color-faint)">
        <span>{t('deployedAt')}</span>
        <span className="text-(--color-muted)">{host}</span>
        <span>·</span>
        <span>{t('instance')}</span>
        <span className="text-(--color-muted)">{hash}</span>
      </div>
    </div>
  );
}

function SidePanel() {
  const t = useTranslations('auth.shell');
  return (
    <aside data-testid="auth-offers" className="hidden lg:block border-l border-(--color-rule) pl-10">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-4">
        {t('whatYouGet')}
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
  const t = useTranslations('auth.shell');
  return (
    <div className="mt-10 pt-6 border-t border-(--color-rule) mono text-[10px] tracking-[0.04em] leading-[1.7] text-(--color-faint)">
      <p><span className="text-(--color-muted)">{t('dataLives')}</span> {t('neverSee')}</p>
      <p className="mt-1">{t('stack')}</p>
    </div>
  );
}

function AuthFooter() {
  const t = useTranslations('auth.shell');
  return (
    <footer className="border-t border-(--color-rule)">
      <div className="max-w-[1180px] mx-auto px-6 lg:px-10 py-7 mono text-[10.5px] tracking-[0.06em] leading-[1.7] text-(--color-muted) flex flex-col md:flex-row md:items-baseline md:justify-between gap-2">
        <div>
          <span className="text-(--color-ink)">{t('brand')}</span>
          <span className="text-(--color-faint) mx-2">·</span>
          <span>{t('tagline')}</span>
        </div>
        <div className="flex items-baseline gap-4">
          <a className="hover:text-(--color-ink)" href="https://github.com/atmaxmoj/standmeet">{t('docs')}</a>
          <a className="hover:text-(--color-ink)" href="https://github.com/atmaxmoj/standmeet">{t('source')}</a>
        </div>
      </div>
    </footer>
  );
}
