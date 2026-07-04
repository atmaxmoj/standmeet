// ActivityTicker —— TopBar 中部。接真 GET /api/admin/stats/activity:从现有行派生的最近事件
// （访客加入 / corpus 写入 / 预约）渲成流动 log。数据/格式化在 use-activity(lib),组件无 if。
// 诚实:无事件显 "no activity yet",不再编假事件流(#47 那串硬编假事件已删)。

'use client';

import { useRecentActivity, tickerLabels } from '@/lib/admin/use-activity';

export function ActivityTicker() {
  const { events } = useRecentActivity();
  const labels = tickerLabels(events);
  return (
    <div
      data-testid="activity-ticker"
      className="ticker-host flex-1 min-w-0 overflow-hidden mx-6 flex gap-4 items-center"
    >
      {labels.map((label, i) => (
        <span
          key={`${label}-${i}`}
          className="mono text-[10px] tracking-[0.14em] text-(--color-muted) whitespace-nowrap"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
