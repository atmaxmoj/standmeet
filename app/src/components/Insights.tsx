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
          <InsightRow key={card.wiki_id} idx={idx} card={card} numbered={insights.length > 1} />
        ))}
      </ol>
    </section>
  );
}

// numbered —— 只有一条时不占序号槽。一条内容配上区标题的计数和左栏的 `01`，
// 是**两处序号 + 一条内容**，读起来像列表没加载完（UX-44）。序号是给"第几条"用的，
// 只有一条时没有"第几条"。
function InsightRow({ idx, card, numbered }: {
  idx: number; card: PagePinCard; numbered: boolean;
}) {
  return (
    <li className={numbered ? 'grid grid-cols-[28px_1fr] gap-5' : ''}>
      <RowOrdinal idx={idx} show={numbered} />
      <div>
        <Link href={`/wiki/${card.path}`} className="group block">
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
