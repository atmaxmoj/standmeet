// ActivityTicker —— TopBar 中部。backend 还没暴露 activity stream,所以这里
// **不再编假事件流** —— 显一句诚实的「stream coming soon」占位。接口出来后
// 换成真 SSE/poll 渲流动 log。
//
// #47:之前这里 marquee 滚一串硬编假事件(ingest/visitor/...),会让 owner 以
// 为系统在实时跑。降级成诚实空态。

export function ActivityTicker() {
  return (
    <div className="ticker-host flex-1 min-w-0 overflow-hidden mx-6">
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint)">
        activity stream · coming soon
      </span>
    </div>
  );
}
