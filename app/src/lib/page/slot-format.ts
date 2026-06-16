// slot-format.ts —— RFC3339 slot → visitor-local display strings + day
// grouping helpers. Shared by BookCard (confirmation) and SlotsCalendarCard
// (the availability picker). Plain Intl.DateTimeFormat, no heavy date lib.

const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric', minute: '2-digit',
});

// formatSlotLocal —— 'Wed Jun 4 · 2:00 PM–2:30 PM' (visitor local tz).
export function formatSlotLocal(startISO: string, endISO: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  return `${dayFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`;
}

// formatTimeRange —— '2:00 PM–2:30 PM' (no day; for chips under a day header).
export function formatTimeRange(startISO: string, endISO: string): string {
  return `${timeFmt.format(new Date(startISO))}–${timeFmt.format(new Date(endISO))}`;
}

// formatDayLabel —— 'Mon Jun 22' for a Date (selected-day header).
export function formatDayLabel(d: Date): string {
  return dayFmt.format(d);
}

// localDayKey —— stable 'y-m-d' key in visitor-local tz for grouping slots by
// day and matching a DayPicker Date back to its slots.
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// localMidnight —— start-of-day Date (visitor-local) for an ISO instant.
export function localMidnight(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
