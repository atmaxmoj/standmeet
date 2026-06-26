// slot-format.ts —— RFC3339 slot → visitor-local display strings + day
// grouping helpers. Used by BookCard (the booked-confirmation legacy card).
// The availability picker is now the booker plugin's ui:// card (own JS
// formatting). Plain Intl.DateTimeFormat, no heavy date lib.

const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric', minute: '2-digit',
});

// formatSlotLocal —— 'Wed Jun 4 · 2:00 PM–2:30 PM' (visitor local tz). BookCard
// 的 booked-confirmation 用；可用时段挑选已是 booker 插件的 ui:// 卡（自带 JS 格式化）。
export function formatSlotLocal(startISO: string, endISO: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  return `${dayFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`;
}
