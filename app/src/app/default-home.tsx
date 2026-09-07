// default-home.tsx — the clean default homepage served when the owner has NOT published their own
// `home` microsite. Rendered from CURRENT code (SDK widgets), so it always tracks the release and
// never goes stale — unlike the old approach that materialized a starter template into the owner's
// storage at claim and froze it (Q1, docs/design/homepage-serve-on-empty.md). No EDIT-ME placeholder
// prose (that "Your project" junk was the frozen starter); just the owner's identity + the live
// widgets: ask box, published insights, access gate, and links to any pages the owner did make.
//
// Widget headings pass as attributes (exempt from the literal-string rule); no free JSX prose here.

'use client';

import { AgentWidget, CorpusWidget, GateWidget, PageNavWidget } from '@standmeet/sdk';

export function DefaultHome({ name, handle }: { name: string; handle: string }) {
  return (
    <main data-testid="default-home" className="mx-auto max-w-[720px] px-6 min-h-screen">
      <section className="pt-20 md:pt-28">
        <div className="mono text-[10.5px] tracking-[0.22em] uppercase text-(--color-muted) mb-8 flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-(--color-accent)" />
          {name || handle}
        </div>
        <AgentWidget />
      </section>
      <section className="mt-24">
        <CorpusWidget heading="things I’ve been thinking about" limit={6} />
      </section>
      <section className="mt-24">
        <GateWidget />
      </section>
      <section className="mt-24 pb-20">
        <PageNavWidget exclude="home" />
      </section>
    </main>
  );
}
