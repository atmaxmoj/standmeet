// SystemPulse —— sidebar 上方的"语料库脉搏"。接真 GET /api/admin/stats/growth:14 天 corpus
// 新增 ASCII 火花线 + 分层总量 + 7 天增量。数据/格式化在 use-corpus-growth(lib),组件无 if。
// 诚实:未加载显 '·' 占位串 + '—',不再编假的 14 天曲线。

'use client';

import { useTranslations } from 'next-intl';

import { useCorpusGrowth, pulseView } from '@/lib/admin/use-corpus-growth';

export function SystemPulse() {
  const t = useTranslations('adminShell.pulse');
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
          {t('title')}
        </div>
        <div className="mono text-[10px] tracking-[0.12em] text-(--color-accent)">{v.delta}</div>
      </div>
      <div className="mono text-[15px] leading-none tracking-[0.15em] text-(--color-accent) mb-1">
        {v.spark}
      </div>
      {/* 火花线画的是**每天新增**,而下面那个大数字是**累计总量**。两者挨着放而没人说明,
          于是曲线看起来像"语料一直只有 1 条"(UX-16)。这一行就是那句说明。 */}
      <div className="mono text-[9px] tracking-[0.08em] text-(--color-faint) mb-2">
        {t('sparkWindow')}
      </div>
      <div className="flex items-baseline justify-between">
        <div className="font-serif text-[22px] leading-none text-(--color-ink)">{v.total}</div>
        <div className="mono text-[9.5px] tracking-[0.08em] text-(--color-faint)">{v.tiers}</div>
      </div>
    </aside>
  );
}
