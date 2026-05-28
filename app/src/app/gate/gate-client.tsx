// gate-client —— gate 页的 client 部分（拆出来让 page.tsx 可 SSR fetch handle）。
// owner handle 仅用于显示文案（"you've reached <handle>'s corpus"），不再决定路由。

'use client';

import { useEffect } from 'react';

import { TopBar } from '@/components/page/TopBar';
import { BYOAIPanel } from '@/components/gate/BYOAIPanel';
import { CodePanel } from '@/components/gate/CodePanel';
import { RequestPanel } from '@/components/gate/RequestPanel';
import { Seal } from '@/components/gate/Seal';
import { WhatsBehind } from '@/components/gate/WhatsBehind';
import { useTheme } from '@/lib/page/use-theme';
import { useGate } from '@/lib/gate/use-gate';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';

type Props = { handle: string };

export function GateClient({ handle }: Props) {
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
          <Hero handle={handle} hook={hook} />
          <Sep />
          <BYOAIPanel hook={hook} />
          <WhatsBehind />
          <RequestPanel handle={handle} hook={hook} />
          <Footnote handle={handle} />
          <GateError message={hook.state.error} />
        </div>
      </main>
      <GateFooter />
    </div>
  );
}

function Hero({ handle, hook }: { handle: string; hook: ReturnType<typeof useGate> }) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-[224px_1fr] gap-10 items-start">
      <div className="flex justify-center md:justify-start">
        <Seal handle={handle} />
      </div>
      <HeroBody handle={handle} hook={hook} />
    </section>
  );
}

function HeroBody({ handle, hook }: { handle: string; hook: ReturnType<typeof useGate> }) {
  return (
    <div>
      <div className="mono text-[10.5px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
        you&rsquo;ve reached {handle}&rsquo;s corpus
      </div>
      <h1 className="font-serif text-(--color-ink) text-[clamp(42px,5.8vw,64px)] font-normal tracking-[-0.02em] leading-none">
        This isn&rsquo;t open<span className="text-(--color-accent)">.</span>
      </h1>
      <p className="font-serif italic text-(--color-muted) mt-4 text-[18.5px] leading-[1.45] font-[380] max-w-[32em]">
        {handle} gives out codes when there&rsquo;s a reason to talk — a hiring loop, an investor call,
        an advisor scoping, a piece of press. If you have a code, drop it in. Otherwise — bring your
        own AI to chat with the public corpus, or leave a note.
      </p>
      <div className="mt-9">
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
          have a code?
        </div>
        <CodePanel hook={hook} />
      </div>
    </div>
  );
}

function Sep() {
  return <div className="mt-14 pt-12 border-t border-(--color-rule)" aria-hidden="true" />;
}

function Footnote({ handle }: { handle: string }) {
  return (
    <p className="mono text-[10px] leading-[1.7] text-(--color-faint) mt-20 max-w-[44em]">
      <span className="text-(--color-muted)">how this works</span> · standmeet replaces a résumé /
      linkedin / cold-email reply with a scoped, on-the-record conversation. it isn&rsquo;t a chatbot
      demo. every code is hand-issued and every transcript is reviewed by {handle}.
    </p>
  );
}

function GateFooter() {
  return (
    <footer className="border-t border-(--color-rule)">
      <div className="max-w-[920px] mx-auto px-6 lg:px-10 py-8 mono text-[11px] leading-[1.7] text-(--color-muted) flex flex-col md:flex-row md:items-baseline md:justify-between gap-2">
        <div>
          <span className="text-(--color-ink)">standmeet</span>
          <span className="text-(--color-faint) mx-2">·</span>
          <span>private corpus retrieval</span>
          <span className="text-(--color-faint) mx-2">·</span>
          <span>by hand, not by feed</span>
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
