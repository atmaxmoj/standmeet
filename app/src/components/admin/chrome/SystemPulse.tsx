// SystemPulse —— sidebar 上方的"语料库脉搏"。backend 还没暴露 corpus growth
// metric,所以**不再画假的 14 天曲线 + 假的「live」7d 数字**(那会让 owner 以为
// 是真统计)。降级成诚实占位,等 /api/admin/stats/growth 出来再接真数。
//
// #47:原来这里 Sparkline(GROWTH_14D 硬编)+ "live" 徽章 + total7/delta 全是假。

export function SystemPulse() {
  return (
    <aside className="crosshair border border-(--color-rule) p-4 bg-(--color-surface)/40 scanline mb-6">
      <span className="ch-tl" /><span className="ch-br" />
      <div className="flex items-baseline justify-between mb-3">
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted)">
          corpus pulse · 14d
        </div>
        <div className="mono text-[10px] tracking-[0.12em] text-(--color-faint)">soon</div>
      </div>
      <p className="mono text-[10.5px] tracking-[0.08em] text-(--color-faint) leading-relaxed m-0">
        growth metrics not yet wired — coming once the stats endpoint lands.
      </p>
    </aside>
  );
}
