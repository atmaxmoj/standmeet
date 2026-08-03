// gate-client —— gate 页的 client 部分（拆出来让 page.tsx 可 SSR fetch handle）。
// owner handle 仅用于显示文案（"you've reached <handle>'s corpus"），不再决定路由。

'use client';

import { useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { TopBar } from '@/components/page/TopBar';
import { BYOAIPanel } from '@/components/gate/BYOAIPanel';
import { CodePanel } from '@/components/gate/CodePanel';
import { RequestPanel } from '@/components/gate/RequestPanel';
import { Seal } from '@/components/gate/Seal';
import { WhatsBehind } from '@/components/gate/WhatsBehind';
import { useTheme } from '@/lib/page/use-theme';
import { useGate } from '@/lib/gate/use-gate';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';

type Props = { handle: string; canDeliverCodes: boolean };

export function GateClient({ handle, canDeliverCodes }: Props) {
  const { dark, toggle } = useTheme();
  const hook = useGate();
  // Landing on /gate means visitor is exiting any prior session — clear it so
  // strip disappears across tabs (storage event fires for other tabs listening
  // to STORAGE_KEY).
  useClearSessionOnMount();
  return (
    <div className="min-h-screen flex flex-col">
      <TopBar handle={handle} dark={dark} onToggleDark={toggle} />
      <main className="flex-1">
        <div className="max-w-[920px] mx-auto px-6 lg:px-10 py-14 lg:py-20">
          <Hero handle={handle} hook={hook} canDeliverCodes={canDeliverCodes} />
          <Sep />
          <BYOAIPanel hook={hook} />
          <WhatsBehind />
          {/* request-access 整块仅在 owner 能发码(connected mail connector)时展示 —— 发不出就别让访客白填 */}
          {canDeliverCodes ? <RequestPanel handle={handle} hook={hook} /> : null}
          <Footnote handle={handle} />
          <GateError message={hook.state.error} />
        </div>
      </main>
      <GateFooter />
    </div>
  );
}

function Hero({
  handle, hook, canDeliverCodes,
}: { handle: string; hook: ReturnType<typeof useGate>; canDeliverCodes: boolean }) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-[224px_1fr] gap-10 items-start">
      <div className="flex justify-center md:justify-start">
        <Seal handle={handle} />
      </div>
      <HeroBody handle={handle} hook={hook} canDeliverCodes={canDeliverCodes} />
    </section>
  );
}

function HeroBody({
  handle, hook, canDeliverCodes,
}: { handle: string; hook: ReturnType<typeof useGate>; canDeliverCodes: boolean }) {
  const t = useTranslations('gate.hero');
  return (
    <div>
      <div className="mono text-[10.5px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
        {t('reached', { handle })}
      </div>
      <h1 className="font-serif text-(--color-ink) text-[clamp(42px,5.8vw,64px)] font-normal tracking-[-0.02em] leading-none">
        {t('headline')}<span className="text-(--color-accent)">.</span>
      </h1>
      <p className="font-serif italic text-(--color-muted) mt-4 text-[18.5px] leading-[1.45] font-[380] max-w-[32em]">
        {t('lede', { handle, note: canDeliverCodes ? t('ledeNote') : '' })}
      </p>
      <div className="mt-9">
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
          {t('haveCode')}
        </div>
        <CodePanel hook={hook} />
      </div>
    </div>
  );
}

function Sep() {
  return <div className="mt-14 pt-12 border-t border-(--color-rule)" aria-hidden="true" />;
}

// muted —— footnote 里 "how this works" 那半句的 rich tag。
const muted = (chunks: ReactNode) => <span className="text-(--color-muted)">{chunks}</span>;

function Footnote({ handle }: { handle: string }) {
  const t = useTranslations('gate.footnote');
  return (
    <p className="mono text-[10px] leading-[1.7] text-(--color-faint) mt-20 max-w-[44em]">
      {t.rich('text', { handle, muted })}
    </p>
  );
}

function GateFooter() {
  const t = useTranslations('gate.footer');
  return (
    <footer className="border-t border-(--color-rule)">
      <div className="max-w-[920px] mx-auto px-6 lg:px-10 py-8 mono text-[11px] leading-[1.7] text-(--color-muted) flex flex-col md:flex-row md:items-baseline md:justify-between gap-2">
        <div>
          <span className="text-(--color-ink)">{t('brand')}</span>
          <span className="text-(--color-faint) mx-2">·</span>
          <span>{t('retrieval')}</span>
          <span className="text-(--color-faint) mx-2">·</span>
          <span>{t('byHand')}</span>
        </div>
      </div>
    </footer>
  );
}

function GateError({ message }: { message: string | null }) {
  return message
    ? <p className="mono text-xs text-(--color-accent) mt-6" data-testid="gate-error">{message}</p>
    : null;
}

function useClearSessionOnMount(): void {
  const clear = useVisitorSessionStore((s) => s.clear);
  useEffect(() => { clear(); }, [clear]);
}
