// CorpusWidget —— the corpus browser widget: every published corpus entry as a card, and a card
// opens IN PLACE (the page never navigates) — clicking pulls the note's body with the keyless
// fetchWikiLanding and renders it as prose, with a quiet "read in full ↗" to the full reader.
//
// Drop-in: `<CorpusWidget />`. Optional `heading` overrides the section label; `limit` caps how
// many cards show.

'use client';

import React, { useEffect, useState } from 'react';
import type { CorpusCard, WikiLandingView } from '@standmeet/sdk-core';

import { paragraphsOf, widgetClient } from './client.js';

export interface CorpusWidgetProps {
  readonly heading?: string;
  readonly limit?: number;
}

export function CorpusWidget({ heading, limit }: CorpusWidgetProps): React.ReactElement | null {
  const [cards, setCards] = useState<CorpusCard[]>([]);
  useEffect(() => { widgetClient.fetchCorpusCards().then(setCards).catch(() => undefined); }, []);

  if (cards.length === 0) return null;
  const shown = typeof limit === 'number' ? cards.slice(0, limit) : cards;
  return (
    <section data-testid="corpus-widget" className="w-full">
      <div className="mono text-[10px] tracking-[0.22em] uppercase text-(--color-faint) mb-7">
        {heading ?? 'from the corpus'}
      </div>
      <ol className="flex flex-col">
        {shown.map((c, i) => <CorpusNote key={c.path} card={c} index={i} />)}
      </ol>
    </section>
  );
}

function CorpusNote({ card, index }: { card: CorpusCard; index: number }) {
  const [open, setOpen] = useState(false);
  const [paras, setParas] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && paras === null && !loading) {
      setLoading(true);
      widgetClient.fetchWikiLanding(card.path)
        .then((v: WikiLandingView | null) => setParas(v ? paragraphsOf(v.body, 4) : []))
        .catch(() => setParas([]))
        .finally(() => setLoading(false));
    }
  };

  return (
    <li className={index === 0 ? 'py-7' : 'py-7 border-t border-(--color-rule)'}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        data-testid={`corpus-widget-card-${card.path}`}
        className="group block w-full text-left"
      >
        <div className="flex items-baseline gap-3">
          <span className="mono text-[11px] text-(--color-faint) shrink-0 tabular-nums">
            {String(index + 1).padStart(2, '0')}
          </span>
          <p className="font-serif text-(--color-ink) group-hover:text-(--color-accent) transition-colors text-[21px] leading-[1.35] font-medium tracking-[-0.006em]">
            {card.title}
          </p>
          <span className="mono text-[11px] text-(--color-faint) group-hover:text-(--color-accent) transition-colors ml-auto shrink-0">
            {open ? '−' : '+'}
          </span>
        </div>
        {card.excerpt !== '' && !open && (
          <p className="mt-2 pl-8 text-(--color-muted) text-[16.5px] leading-[1.55] max-w-[42ch]">
            {card.excerpt}
          </p>
        )}
      </button>
      {open && (
        <div data-testid={`corpus-widget-body-${card.path}`} className="pl-8 mt-4">
          {loading && paras === null && (
            <p className="mono text-[11px] text-(--color-faint)">reading…</p>
          )}
          {paras !== null && paras.map((p, i) => (
            <p key={i} className="text-(--color-ink) text-[17px] leading-[1.65] mb-3 max-w-[54ch]">
              {p}
            </p>
          ))}
          <a
            href={`/wiki/${card.path}`}
            className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-accent) hover:tracking-[0.2em] transition-all inline-block mt-1"
          >
            read in full ↗
          </a>
        </div>
      )}
    </li>
  );
}
