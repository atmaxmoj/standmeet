// App.tsx — the default StandMeet homepage, authored as a microsite.
//
// This is the seed installed as the reserved `home` page at claim. It IS the homepage now — a
// microsite pinned to `/` — so the owner edits it like any other page.
//
// It does NOT hand-write its blocks: it COMPOSES the managed site widgets from @standmeet/sdk
// (the central place those live). This file only decides identity prose + which widgets go where.
// The widgets:
//   • AgentWidget   — the ask box (a codeless visitor's question hands off to /gate).
//   • GateWidget    — the access CTA (enter a code / bring a key / request access).
//   • CorpusWidget  — published corpus entries as cards that open inline (no redirect).
//   • PageNavWidget — links to the owner's other pages.
//
// Styling uses the StandMeet design system shipped into every build (builder/template/theme.css).

import React, { useEffect, useState } from 'react';
import {
  AgentWidget, GateWidget, CorpusWidget, PageNavWidget,
} from '@standmeet/sdk';

interface Instance { handle: string; name: string }

// EDIT ME — your opening line. The one thing this page always leads with.
const HERO = 'I think out loud here. Ask me anything, or read what I have been working through.';

// EDIT ME — a few questions worth asking, to prime a visitor.
const EXAMPLES = ['What are you thinking about lately?', 'What are you building?'];

// EDIT ME — where you are / what you are open to.
const WHERE = 'Open to conversations. The chat above answers in my voice, grounded in the notes below.';

export default function App() {
  const [inst, setInst] = useState<Instance | null>(null);
  useEffect(() => {
    fetch('/api/v1/instance').then((r) => r.json()).then((d: Instance) => setInst(d)).catch(() => {});
  }, []);

  return (
    <main className="mx-auto max-w-[720px] px-6 min-h-screen">
      <section className="pt-20 md:pt-28">
        <div className="mono text-[10.5px] tracking-[0.22em] uppercase text-(--color-muted) mb-6">
          <span className="text-(--color-accent)">●</span> {inst ? inst.name : ' '}
        </div>
        <p className="font-serif text-(--color-ink) text-[clamp(28px,3.6vw,42px)] leading-[1.28] font-[380] tracking-[-0.014em] [text-wrap:pretty] max-w-[24ch] mb-12">
          {HERO}
        </p>
        {/* Agent widget — ask box (hands off to /gate). */}
        <AgentWidget examples={EXAMPLES} />
      </section>

      {/* Gate widget — the access CTA. */}
      <section className="mt-16">
        <GateWidget />
      </section>

      {/* Corpus widget — published entries as inline-expanding cards. */}
      <section className="mt-24">
        <CorpusWidget heading="things I’ve been thinking about" />
      </section>

      <section className="mt-24 grid gap-12 md:grid-cols-2">
        <div>
          <div className="mono text-[10px] tracking-[0.22em] uppercase text-(--color-faint) mb-3">where I am</div>
          <p className="text-(--color-ink) text-[17px] leading-[1.65]">{WHERE}</p>
        </div>
        {/* Page-nav widget — the owner's other pages (this one, `home`, is excluded). */}
        <PageNavWidget exclude="home" />
      </section>

      <footer className="mt-24 pb-20 mono text-[10px] tracking-[0.15em] uppercase text-(--color-faint)">
        {inst ? `${inst.name} · standmeet` : ' '}
      </footer>
    </main>
  );
}
