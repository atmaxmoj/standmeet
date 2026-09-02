// gate-client — the client part of the /gate page (split out so page.tsx can SSR-fetch the handle).
// owner handle is display copy only ("you've reached <handle>'s corpus") — it no longer drives routing.

'use client';

import { useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { TopBar } from '@/components/page/TopBar';
import { BYOAIPanel } from '@/components/gate/BYOAIPanel';
import { CodePanel } from '@/components/gate/CodePanel';
import { ReadPanel } from '@/components/gate/ReadPanel';
import { RequestPanel } from '@/components/gate/RequestPanel';
import { Seal } from '@/components/gate/Seal';
import { WhatsBehind } from '@/components/gate/WhatsBehind';
import { useTheme } from '@/lib/page/use-theme';
import { useGate } from '@/lib/gate/use-gate';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';

type Props = {
  handle: string;
  canDeliverCodes: boolean;
  publicWiki: number;
  publicWritings: number;
};

export function GateClient({ handle, canDeliverCodes, publicWiki, publicWritings }: Props) {
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
          {/* Read comes before BYOAI: these three doors are ordered by rising cost. Public
              content needs no credential at all, while BYOAI asks the visitor for their
              own API key. Putting the cheapest door last (or omitting it, as before) made
              "read what they wrote" harder to reach than "go get a key". */}
          <ReadPanel publicWiki={publicWiki} publicWritings={publicWritings} />
          <BYOAIPanel hook={hook} />
          <WhatsBehind />
          {/* The whole request-access block only shows when the owner can deliver codes
              (a connected mail connector) — don't let visitors fill a form that can't send. */}
          {canDeliverCodes ? <RequestPanel handle={handle} hook={hook} /> : null}
          {/* A page-level error line used to live here. It was the only error surface when the
              three doors shared one piece of state, but it sat far from each door and spoke for
              whichever one failed — now each door reports for itself (CodePanel's HintStatus /
              BYOAIError / RequestError), making this line a redundant third echo (F-G-6). */}
          <Footnote handle={handle} />
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

// muted — rich-text tag for the "how this works" half of the footnote.
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

function useClearSessionOnMount(): void {
  const clear = useVisitorSessionStore((s) => s.clear);
  useEffect(() => { clear(); }, [clear]);
}
