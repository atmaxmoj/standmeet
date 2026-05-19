// SystemPulse —— sidebar 上方的"语料库脉搏"。14 天每日新增条目数。
// 数据是占位（chrome-data），UI 把当前 7 日 vs 上 7 日的 delta 画出来。

import { Sparkline } from '../atoms/Sparkline';
import { GROWTH_14D } from '@/lib/admin/chrome-data';
import { computePulse } from '@/lib/admin/pulse';

export function SystemPulse() {
  const pulse = computePulse(GROWTH_14D);
  return (
    <aside className="crosshair border border-(--color-rule) p-4 bg-(--color-surface)/40 scanline mb-6">
      <span className="ch-tl" /><span className="ch-br" />
      <div className="flex items-baseline justify-between mb-3">
        <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted)">
          corpus pulse · 14d
        </div>
        <div className="mono text-[10px] tracking-[0.12em] text-(--color-faint)">live</div>
      </div>
      <PulseBody total7={pulse.total7} delta={pulse.delta} />
    </aside>
  );
}

function PulseBody({ total7, delta }: { total7: number; delta: number }) {
  const deltaCls = delta >= 0 ? 'text-(--color-accent)' : 'text-(--color-faint)';
  const arrow = delta >= 0 ? '↑' : '↓';
  return (
    <div className="flex items-end gap-4">
      <div>
        <div className="font-serif text-[28px] leading-none">{total7}</div>
        <div className="mono text-[10px] tracking-[0.12em] text-(--color-muted) mt-1">
          entries · last 7d
          <span className={`ml-2 ${deltaCls}`}>{arrow} {Math.abs(delta)}</span>
        </div>
      </div>
      <div className="flex-1">
        <Sparkline data={GROWTH_14D} width={130} height={28} label="entries per day" />
        <div className="mono text-[9.5px] tracking-[0.1em] text-(--color-faint) mt-1 flex justify-between">
          <span>14d ago</span><span>today</span>
        </div>
      </div>
    </div>
  );
}
