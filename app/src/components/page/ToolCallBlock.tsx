// ToolCallBlock —— design 源 app.js ToolCallBlock (235-296)。
// 结构化渲染 tool call 结果：calendar slots / booking confirmation /
// image figure / file download pill。
//
// 当前 backend 不返 tool_calls 结构 —— visitor chat 只返 prose answer。
// 这个组件先 export 备用；ConversationDeck 在 answer 有 tool_calls 字段
// 时渲染。没有 tool_calls → 不渲染 → 无回归。

export interface ToolCallResult {
  kind: 'calendar' | 'booking' | 'image' | 'file';
  slots?: readonly { day: string; time: string }[];
  ics?: string;
  dims?: string;
  caption?: string;
  label?: string;
  size_kb?: number;
}

export interface ToolCall {
  tool: string;
  result: ToolCallResult;
}

export function ToolCallBlock({ tool, result }: { tool: string; result: ToolCallResult }) {
  const map: Record<string, () => React.ReactNode> = {
    calendar: () => <CalendarBlock tool={tool} result={result} />,
    booking: () => <BookingBlock tool={tool} result={result} />,
    image: () => <ImageBlock result={result} />,
    file: () => <FileBlock result={result} />,
  };
  const renderer = map[result.kind];
  return renderer ? <>{renderer()}</> : null;
}

function CalendarBlock({ tool, result }: { tool: string; result: ToolCallResult }) {
  const slots = result.slots ?? [];
  return (
    <div className="border border-(--color-rule) bg-(--color-surface)/40 mt-3 mb-1 rounded-[3px]">
      <CalendarHeader tool={tool} count={slots.length} />
      <div className="px-3 py-2">
        {slots.map((s, i) => <CalendarSlot key={i} day={s.day} time={s.time} />)}
      </div>
    </div>
  );
}

function CalendarHeader({ tool, count }: { tool: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between px-3 py-1.5 border-b border-(--color-rule)/70">
      <span className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-accent)">⌖ tool · {tool}</span>
      <span className="mono text-[10px] tracking-[0.1em] uppercase text-(--color-faint)">{count} slots offered</span>
    </div>
  );
}

function CalendarSlot({ day, time }: { day: string; time: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr_auto] gap-3 items-baseline py-1.5 border-b border-(--color-rule)/40 last:border-0">
      <span className="mono text-[11.5px] text-(--color-ink)">{day}</span>
      <span className="mono text-[11.5px] text-(--color-muted)">{time}</span>
      <button type="button" className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) hover:text-(--color-accent)">book →</button>
    </div>
  );
}

function BookingBlock({ tool, result }: { tool: string; result: ToolCallResult }) {
  return (
    <div className="border border-(--color-accent)/50 bg-(--color-paper)/60 mt-3 mb-1 rounded-[3px]">
      <div className="flex items-baseline justify-between px-3 py-2">
        <span className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-accent)">✓ booked · {tool}</span>
        {result.ics && (
          <span className="mono text-[10px] tracking-[0.1em] text-(--color-muted)">{result.ics} ↓</span>
        )}
      </div>
    </div>
  );
}

function ImageBlock({ result }: { result: ToolCallResult }) {
  return (
    <figure className="mt-3 mb-1 max-w-[460px]">
      <div
        className="border border-(--color-rule) rounded-[3px] relative bg-(--color-surface)"
        // aspect-ratio is presentation-only
        // eslint-disable-next-line no-restricted-syntax
        style={{ aspectRatio: '4/3' }}
      >
        <span className="mono absolute bottom-1.5 left-2 text-[9px] tracking-[0.06em] text-(--color-paper) bg-(--color-ink)/80 px-1 py-px">
          IMG · {result.dims ?? '—'}
        </span>
      </div>
      {result.caption && (
        <figcaption className="mono text-[10px] text-(--color-faint) mt-2 tracking-[0.06em]">{result.caption}</figcaption>
      )}
    </figure>
  );
}

function FileBlock({ result }: { result: ToolCallResult }) {
  return (
    <div className="mt-3 mb-1 inline-flex items-baseline gap-3 px-3 py-2 border border-(--color-rule) rounded-[3px]">
      <span className="mono text-[12px] text-(--color-accent)">▤</span>
      <span className="mono text-[11.5px] text-(--color-ink)">{result.label ?? 'file'}</span>
      {result.size_kb !== undefined && (
        <span className="mono text-[10px] text-(--color-faint)">· {result.size_kb} kb</span>
      )}
      <span className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) hover:text-(--color-accent) ml-2">download ↓</span>
    </div>
  );
}
