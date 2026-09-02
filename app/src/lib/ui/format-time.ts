// format-time —— this product has **only** these three time formats, and they all live here.
//
// Why this module exists (UX-46): across three surfaces in one owner session, three different
// formats showed up — the transcript modal's `8/8/2026, 10:16:07 AM` (US locale + seconds +
// AM/PM), the dashboard's "last visit" `2026-08-07T01:09:14Z` (ISO + Z, meant for machines), and
// the same page's title `last refresh · now` (relative). This is the visual counterpart of
// [[vocabulary-must-not-diverge]]: one concept, one format.
//
// Same root cause as UX-47 (five dropdown styles) / UX-59 (two input-field looks) — **without
// this layer**, every surface independently reaches for `toISOString().slice(0,10)` /
// `toLocaleString()` (the former got copy-pasted four times).
//
// Three formats, split by **what the reader is using it for**:
//   - `ago()`         —— "how long ago" in lists and cards. Scanning wants freshness, not a
//                        coordinate. The exact value goes in the title, visible on hover.
//   - `stampMinute()` —— transcripts, quotes, anything meant to be pasted elsewhere. Minutes
//                        are enough; seconds add noise without adding use.
//   - `stampDay()`    —— rows that only care which day (created on, updated on).
//
// All rendered in the **local timezone**: the reader is the owner, not a machine. `toISOString()`
// is UTC, which in UTC+8 turns a local early-morning timestamp into the previous day — that was
// the bug shared by all four of the original copy-pasted call sites.
//
// Bad input is returned unchanged: a display function shouldn't swallow the owner's data
// ([[display-fallback-reintroduces-the-bug]] is about the opposite failure — here, returning the
// raw string keeps bad data **visible**, instead of passing it off as good data).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RELATIVE_HORIZON = 7 * DAY;

function parse(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** stampDay —— `2026-08-08`. The day, in the local timezone. */
export function stampDay(iso: string): string {
  const d = parse(iso);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : iso;
}

/** stampMinute —— `2026-08-08 10:16`. Use this where the value gets quoted or pasted elsewhere. */
export function stampMinute(iso: string): string {
  const d = parse(iso);
  return d ? `${stampDay(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : iso;
}

/**
 * ago —— `just now` / `12m ago` / `3h ago` / `2d ago`, falling back to `stampDay` past a week.
 * `now` exists only for testability; call sites don't pass it.
 */
export function ago(iso: string, now: number = Date.now()): string {
  const d = parse(iso);
  if (!d) return iso;
  const delta = now - d.getTime();
  if (delta < 0) return stampMinute(iso);          // future timestamp: a relative phrasing wouldn't read right
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < RELATIVE_HORIZON) return `${Math.floor(delta / DAY)}d ago`;
  return stampDay(iso);
}
