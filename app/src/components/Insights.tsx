// Insights —— "things I've been thinking about". Insights is a pin window
// over the corpus (docs/design/page-corpus-pinning.md): each card is the
// title + excerpt of a pinned published entry, linking to the /wiki/<path>
// reader — not a second copy of the content.
// An empty section (nothing pinned) doesn't render at all, not even the
// heading.

import Link from 'next/link';

import { corpusHref } from '@/lib/corpus/href';
import type { PagePinCard } from '@/lib/api/public';

import { DeckHeader } from '@/components/page/DeckHeader';

export function Insights({ insights }: { insights: readonly PagePinCard[] }) {
  return insights.length === 0 ? null : (
    <section className="mt-24">
      <DeckHeader kicker="things I've been thinking about" count={insights.length} />
      <ol className="space-y-7">
        {insights.map((card, idx) => (
          <InsightRow key={card.wiki_id} idx={idx} card={card} numbered={insights.length > 1} />
        ))}
      </ol>
    </section>
  );
}

// numbered —— with a single item, no ordinal slot is used. Pairing one item
// with both the section heading's count and a left-column `01` gives
// **two ordinals for one item**, which reads like a list that didn't finish
// loading (UX-44). The ordinal exists to say "which one of several"; with
// only one item there is no "which one".
function InsightRow({ idx, card, numbered }: {
  idx: number; card: PagePinCard; numbered: boolean;
}) {
  return (
    <li
      className={numbered ? 'grid grid-cols-[28px_1fr] gap-5' : ''}
      data-testid={`insight-card-${card.path}`}
    >
      <RowOrdinal idx={idx} show={numbered} />
      <div>
        <Link href={corpusHref({ genre: 'wiki', path: card.path })} className="group block">
          <InsightTitle text={card.title} />
        </Link>
        <InsightExcerpt text={card.excerpt} />
      </div>
    </li>
  );
}

function RowOrdinal({ idx, show }: { idx: number; show: boolean }) {
  return show ? (
    <span className="mono text-[10px] tracking-[0.14em] text-(--color-faint) tabular-nums pt-2.5">
      {String(idx + 1).padStart(2, '0')}
    </span>
  ) : null;
}

function InsightTitle({ text }: { text: string }) {
  return (
    <p className="font-serif text-(--color-ink) group-hover:text-(--color-accent) transition-colors text-[20px] leading-[1.4] font-medium tracking-[-0.005em]">
      {text}
    </p>
  );
}

function InsightExcerpt({ text }: { text: string }) {
  return text === '' ? null : (
    <p className="reading text-(--color-muted) mt-2 text-[16.5px] max-w-[38em]">
      {text}
    </p>
  );
}
