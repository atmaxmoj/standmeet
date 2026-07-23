// Insights —— "things I've been thinking about"。insights 是 corpus 的 pin
// 窗口(docs/design/page-corpus-pinning.md):每张卡是被 pin 的已发布条目的
// title + excerpt,链去 /wiki/<path> 的 reader —— 不是第二份内容。
// 空栏目(没 pin)整个不渲染,标题也不渲。

import Link from 'next/link';

import type { PagePinCard } from '@/lib/api/public';

import { DeckHeader } from '@/components/page/DeckHeader';

export function Insights({ insights }: { insights: readonly PagePinCard[] }) {
  return insights.length === 0 ? null : (
    <section className="mt-24">
      <DeckHeader kicker="things I've been thinking about" count={insights.length} />
      <ol className="space-y-7">
        {insights.map((card, idx) => (
          <InsightRow key={card.wiki_id} idx={idx} card={card} />
        ))}
      </ol>
    </section>
  );
}

function InsightRow({ idx, card }: { idx: number; card: PagePinCard }) {
  return (
    <li className="grid grid-cols-[28px_1fr] gap-5">
      <span className="mono text-[10px] tracking-[0.14em] text-(--color-faint) tabular-nums pt-2.5">
        {String(idx + 1).padStart(2, '0')}
      </span>
      <div>
        <Link href={`/wiki/${card.path}`} className="group block">
          <InsightTitle text={card.title} />
        </Link>
        {card.excerpt !== '' && <InsightExcerpt text={card.excerpt} />}
      </div>
    </li>
  );
}

function InsightTitle({ text }: { text: string }) {
  return (
    <p className="font-serif text-(--color-ink) group-hover:text-(--color-accent) transition-colors text-[20px] leading-[1.4] font-medium tracking-[-0.005em]">
      {text}
    </p>
  );
}

function InsightExcerpt({ text }: { text: string }) {
  return (
    <p className="reading text-(--color-muted) mt-2 text-[16.5px] max-w-[38em]">
      {text}
    </p>
  );
}
