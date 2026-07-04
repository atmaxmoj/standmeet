// SystemPulse —— sidebar 上方的"语料库脉搏"。接真 GET /api/admin/stats/growth:14 天 corpus
// 新增 ASCII 火花线 + 分层总量 + 7 天增量。数据/格式化在 use-corpus-growth(lib),组件无 if。
// 诚实:未加载显 '·' 占位串 + '—',不再编假的 14 天曲线。

'use client';

import { useCorpusGrowth, pulseView } from '@/lib/admin/use-corpus-growth';

export function SystemPulse() {
  const { growth } = useCorpusGrowth();
  const v = pulseView(growth);
  return (
    <aside
      data-testid="system-pulse"
      className="crosshair border border-(--color-rule) p-4 bg-(--color-surface)/40 scanline mb-6"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <div className="flex items-baseline justify-between mb-3">
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted)">
          corpus pulse · 14d
        </div>
        <div className="mono text-[10px] tracking-[0.12em] text-(--color-accent)">{v.delta}</div>
      </div>
      <div className="mono text-[15px] leading-none tracking-[0.15em] text-(--color-accent) mb-2">
        {v.spark}
      </div>
      <div className="flex items-baseline justify-between">
        <div className="font-serif text-[22px] leading-none text-(--color-ink)">{v.total}</div>
        <div className="mono text-[9.5px] tracking-[0.08em] text-(--color-faint)">{v.tiers}</div>
      </div>
    </aside>
  );
}
