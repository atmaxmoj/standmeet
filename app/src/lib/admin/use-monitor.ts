// use-monitor —— /admin/monitor state: the visitor-traffic summary + the raw event feed.
//
// Two resources rather than one: the summary is five numbers the owner reads first, the feed is
// a list they scan after. Loading them separately means a slow feed cannot delay the numbers,
// and an empty instance still renders the zeros instead of a spinner.
//
// Backend: GET /api/admin/monitor/stats and /events (docs/design/monitor.md §5).

import { useEffect } from 'react';

import { z } from 'zod';
import { create } from 'zustand';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export const MonitorSummarySchema = z.object({
  viewers: z.number(),
  visits: z.number(),
  views: z.number(),
  events: z.number(),
  bots: z.number(),
});
export type MonitorSummary = z.infer<typeof MonitorSummarySchema>;

// MonitorEventSchema —— every field the backend sends. Declared in full rather than picked:
// a server that narrows its response would otherwise fail this schema silently and blank the
// whole panel, and "the panel is empty" reads as "nobody visited".
export const MonitorEventSchema = z.object({
  event_id: z.string(),
  viewer_id: z.string(),
  visit_id: z.string(),
  created_at: z.string(),
  surface: z.string(),
  event_name: z.string(),
  is_bot: z.boolean(),
  url_path: z.string(),
  page_title: z.string(),
  referrer_domain: z.string(),
  src: z.string(),
  entity_kind: z.string(),
  entity_id: z.string(),
  entity_title: z.string(),
  code_id: z.string(),
  code_label: z.string(),
  browser: z.string(),
  os: z.string(),
  device: z.string(),
  country: z.string(),
  bot_name: z.string(),
  props: z.record(z.string(), z.string()),
});
export type MonitorEvent = z.infer<typeof MonitorEventSchema>;

const EventsResponseSchema = z.object({ events: z.array(MonitorEventSchema) });

const EMPTY_SUMMARY: MonitorSummary = {
  viewers: 0, visits: 0, views: 0, events: 0, bots: 0,
};

// MONITOR_WINDOWS —— the three spans, mirroring the backend's (monitor/repo/window.go). Three
// and not a date picker: a traffic panel answers "is this going anywhere", and last week / last
// month / last quarter answers it. 90d is also the retention limit, so there is nothing older
// to ask for.
export const MONITOR_WINDOWS = ['7d', '28d', '90d'] as const;
export type MonitorWindow = typeof MONITOR_WINDOWS[number];

interface WindowState {
  window: MonitorWindow;
  setWindow: (w: MonitorWindow) => void;
}

// monitorWindowStore —— which span the panel is showing.
//
// ONE window for both resources, held outside them. The summary and the feed beside it must be
// counted over the same span: two independent windows would let the panel print "3 viewers" over
// a list of fifty rows from a different month, and nothing on screen would say why.
export const monitorWindowStore = create<WindowState>((set) => ({
  window: '28d',
  setWindow: (w) => {
    set({ window: w });
    // Both, together. Refreshing only the one the owner "changed" is what produces a mismatched
    // pair, and a mismatched pair looks like data rather than a bug.
    void monitorSummaryStore.getState().refresh();
    void monitorEventsStore.getState().refresh();
  },
}));

function currentWindow(): MonitorWindow {
  return monitorWindowStore.getState().window;
}

export const monitorSummaryStore = createResourceStore<MonitorSummary>({
  name: 'monitor-summary',
  fetcher: () => adminAPI.get(`/monitor/stats?window=${currentWindow()}`, MonitorSummarySchema),
});

// The feed asks for bots; the summary does not.
//
// That split is the whole point of storing a crawler's name. "1 crawler" tells the owner
// nothing they can act on; "Googlebot read your corpus" and "your link was unfurled in Slack"
// are two different pieces of news, and the feed is the only place they can be told apart. The
// four human numbers stay bot-free, so the feed showing them costs nothing.
export const monitorEventsStore = createResourceStore<MonitorEvent[]>({
  name: 'monitor-events',
  fetcher: () => adminAPI
    .get(
      `/monitor/events?limit=50&include_bots=true&window=${currentWindow()}`,
      EventsResponseSchema,
    )
    .then((r) => r.events),
});

// MonitorRow —— one feed line, already reduced to the five strings the panel prints.
//
// The reduction happens here, not in the component: the presentation layer holds no branches
// (its lint rule says so, and the rule is right — "which of these three fields do we show" is a
// decision about the data, and a decision about the data is testable only where the data is).
export interface MonitorRow {
  id: string;
  time: string;
  surface: string;
  what: string;
  from: string;
  who: string;
}

// FeedView —— which of the three the feed is actually in.
//
// Three, not two. "Loading" and "nothing recorded" are different facts and must not render the
// same: a heading over an empty table reads as "you have no visitors" while the request is
// still in flight, and that is a lie the owner has no way to see through.
export type FeedView = 'loading' | 'empty' | 'rows';

export interface MonitorHook {
  status: ResourceStatus;
  summary: MonitorSummary;
  rows: readonly MonitorRow[];
  view: FeedView;
  error: string | null;
  window: MonitorWindow;
  setWindow: (w: MonitorWindow) => void;
}

export function useMonitor(): MonitorHook {
  const summary = useResource(monitorSummaryStore);
  const events = useResource(monitorEventsStore);
  const window = monitorWindowStore((s) => s.window);
  const setWindow = monitorWindowStore((s) => s.setWindow);
  // refresh, not ensureLoaded. Traffic is live: `ensureLoaded` fetches once and then serves the
  // same snapshot for the rest of the session, so an owner who opens the panel, goes away, and
  // comes back reads yesterday's numbers with nothing on screen saying so. Every other section
  // here describes state the owner themselves changed; this one describes other people.
  const loadSummary = monitorSummaryStore.getState().refresh;
  const loadEvents = monitorEventsStore.getState().refresh;
  useEffect(() => { void loadSummary(); void loadEvents(); }, [loadSummary, loadEvents]);
  // The panel is ready once BOTH have answered: showing the feed under a still-loading zero
  // would read as "50 events, 0 viewers", which is a number the data never said.
  const status = worstStatus(summary.status, events.status);
  const rows = (events.data ?? []).map(toRow);
  return {
    status,
    summary: summary.data ?? EMPTY_SUMMARY,
    rows,
    view: feedView(status, rows.length),
    error: summary.error ?? events.error,
    window, setWindow,
  };
}

function feedView(status: ResourceStatus, rowCount: number): FeedView {
  if (status !== 'ready') return 'loading';
  return rowCount === 0 ? 'empty' : 'rows';
}

const DASH = '—';

export function toRow(event: MonitorEvent): MonitorRow {
  return {
    id: event.event_id,
    time: shortTime(event.created_at),
    surface: event.surface,
    what: what(event),
    from: event.referrer_domain === '' ? DASH : event.referrer_domain,
    who: who(event),
  };
}

// what —— the entry's title when the event is about one, then the event's name, then the path.
// The title wins because a path is an address and a title is what the owner actually wrote.
function what(event: MonitorEvent): string {
  return firstNonEmpty([event.entity_title, event.event_name, event.url_path]);
}

// who —— a crawler is named; a person is described by their device. Neither is an identity: the
// viewer id is a monthly-salted hash and nothing else about them is stored.
function who(event: MonitorEvent): string {
  const human = [event.browser, event.os, event.country].filter((s) => s !== '').join(' · ');
  return event.is_bot ? firstNonEmpty([event.bot_name, 'bot']) : firstNonEmpty([human]);
}

function firstNonEmpty(candidates: readonly string[]): string {
  return candidates.find((s) => s !== '') ?? DASH;
}

// shortTime —— hh:mm in the reader's own timezone. A feed whose point is "what happened
// recently" does not earn a column for the year.
function shortTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? DASH
    : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// worstStatus —— error beats loading beats ready. A panel is only ready when nothing is still
// in flight and nothing failed.
function worstStatus(a: ResourceStatus, b: ResourceStatus): ResourceStatus {
  for (const s of ['error', 'loading', 'idle'] as const) {
    if (a === s || b === s) return s;
  }
  return a;
}
