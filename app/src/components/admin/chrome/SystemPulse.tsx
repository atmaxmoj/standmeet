// SystemPulse — the "corpus pulse" panel above the sidebar. Wired to the real
// GET /api/admin/stats/growth: 14-day corpus additions as an ASCII sparkline,
// plus tiered totals and the 7-day delta. Data/formatting lives in
// use-corpus-growth (lib); the component has no if-branches.
// Honest about loading state: shows a '·' placeholder string + '—' instead of
// faking a 14-day curve while data is unavailable.

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
      // shrink-0 — this panel sits in a `flex flex-col` sidebar, and flex children
      // shrink by default. With enough nav items (26 here), it gets squeezed down
      // to just the title row: the sparkline, total, and tier counts are still in
      // the DOM, just clipped outside a 30px box — in the real environment the
      // owner never actually saw those numbers (F-C-11).
      // A text assertion can't tell "rendered" apart from "squashed", so that
      // assertion was replaced with a geometry check.
      className="crosshair shrink-0 border border-(--color-rule) p-4 bg-(--color-surface)/40 scanline mb-6"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <div className="flex items-baseline justify-between mb-3">
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted)">
          {t('title')}
        </div>
        <div
          className="mono text-[10px] tracking-[0.12em] text-(--color-accent)"
          data-testid="pulse-rail-delta"
        >
          {v.delta}
        </div>
      </div>
      <div className="mono text-[15px] leading-none tracking-[0.15em] text-(--color-accent) mb-1">
        {v.spark}
      </div>
      {/* The sparkline plots **daily additions**, while the big number below it is
          the **cumulative total**. Placed side by side with no label, the curve
          reads as "the corpus only ever has 1 item" (UX-16). This line is that
          missing label. */}
      <div className="mono text-[9px] tracking-[0.08em] text-(--color-faint) mb-2">
        {t('sparkWindow')}
      </div>
      {/* 232px isn't wide enough for "big number + three tier segments" side by
          side — they'd overlap. Stack them vertically instead. */}
      <div className="font-serif text-[22px] leading-none text-(--color-ink)">{v.total}</div>
      <div
        className="mono text-[9.5px] tracking-[0.08em] text-(--color-faint) mt-1"
        data-testid="pulse-tiers"
      >
        {v.tiers}
      </div>
    </aside>
  );
}
