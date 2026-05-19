// ActivityTicker —— TopBar 中部的"流动 log"。double 数列让 marquee 无缝循环。
// pure visual; 数据来自 chrome-data 静态占位（backend 还没暴露 stream）。

import type { TickerItem } from '@/lib/admin/chrome-data';

type Props = { items: readonly TickerItem[] };

const EVT_CLS: Record<TickerItem['evt'], string> = {
  ingest:         'text-(--color-ink)',
  visitor:        'text-(--color-ink)',
  'private-hit':  'text-(--color-accent)',
  promote:        'text-(--color-muted)',
  connector:      'text-(--color-muted)',
};

export function ActivityTicker({ items }: Props) {
  const doubled = [...items, ...items];
  return (
    <div className="ticker-host flex-1 min-w-0 overflow-hidden mx-6">
      <div className="ticker-track flex items-baseline gap-7">
        {doubled.map((it, i) => <TickerEntry key={i} item={it} />)}
      </div>
    </div>
  );
}

function TickerEntry({ item }: { item: TickerItem }) {
  return (
    <span className="inline-flex items-baseline gap-2 mono text-[10.5px] tracking-[0.04em] whitespace-nowrap">
      <span className="text-(--color-faint) tabular-nums">{item.t}</span>
      <span className={`uppercase tracking-[0.14em] text-[9.5px] ${EVT_CLS[item.evt]}`}>{item.evt}</span>
      <span className="text-(--color-muted)">{item.detail}</span>
      <span className="text-(--color-faint)">·</span>
    </span>
  );
}
