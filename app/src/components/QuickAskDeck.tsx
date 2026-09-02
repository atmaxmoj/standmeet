// QuickAskDeck —— ported from the design source's app.js QuickAskDeck.
// A 3-col grid of 12 curated questions, grouped by section, click → fires
// onAsk. An already-asked item is shown line-through and greyed out. A
// private label in accent color signals that a code is needed.
//
// The backend currently has no dedicated "sections + questions" schema — this
// renders hero_examples as a flat list in a single column instead. The
// design's 3-col grouped layout needs the owner to configure sections
// (work & trajectory / thinking / fit & availability) — for now it falls
// back to a flat render of the owner's examples, with the UI structure fully
// in place.

'use client';

import { DeckHeader } from '@/components/page/DeckHeader';

interface Props {
  examples: readonly string[];
  askedSet: ReadonlySet<string>;
  onAsk: (q: string) => void;
}

// 6+ examples → render QuickAskDeck (below that, Hero's inline Examples is enough)
const MIN_FOR_DECK = 6;

export function QuickAskDeck({ examples, askedSet, onAsk }: Props) {
  return examples.length < MIN_FOR_DECK ? null : (
    <section className="mt-24">
      <DeckHeader kicker="what people usually ask" count={examples.length} />
      <QuickAskGrid examples={examples} askedSet={askedSet} onAsk={onAsk} />
    </section>
  );
}

function QuickAskGrid({ examples, askedSet, onAsk }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-3" data-testid="quick-ask-deck">
      {examples.map((q, i) => (
        <QuickAskRow key={q} idx={i + 1} label={q} asked={askedSet.has(q)} onAsk={() => onAsk(q)} />
      ))}
    </div>
  );
}

function QuickAskRow({ idx, label, asked, onAsk }: {
  idx: number; label: string; asked: boolean; onAsk: () => void;
}) {
  const textCls = asked
    ? 'text-(--color-muted) line-through decoration-(--color-faint)/60'
    : 'text-(--color-ink) group-hover:text-(--color-accent)';
  return (
    <button
      type="button"
      onClick={onAsk}
      className="group w-full text-left flex items-baseline gap-2.5 py-1.5 border-b border-(--color-rule)/40 transition-colors"
    >
      <span className="mono text-[9.5px] text-(--color-faint) tabular-nums shrink-0 w-5 pt-1">
        {String(idx).padStart(2, '0')}
      </span>
      <span className={`font-serif flex-1 transition-colors text-[14.5px] leading-[1.4] font-normal tracking-[-0.002em] ${textCls}`}>
        {label}
      </span>
    </button>
  );
}
