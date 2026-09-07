// beacon —— the browser's half of the traffic instrumentation (docs/design/monitor.md §4).
//
// The backend records what a request can show. This reports the rest: that the index was
// actually looked at (its page is rendered by the app, so the backend only ever sees a liveness
// probe), how far down someone read, and whether they reached the end.
//
// Three rules, all of them about not being a burden on the visitor:
//
//  1. Fire and forget. `sendBeacon` where it exists, a keepalive fetch otherwise. Nothing here
//     is awaited, and no failure is surfaced — a visitor must never see or feel analytics.
//  2. Nothing identifying is sent. No id, no fingerprint, no storage of any kind. Who the
//     visitor is gets derived server-side from the request, where it cannot be faked.
//  3. Each threshold fires once per page. A scroll bar dragged up and down is one reader, not
//     twenty, and a counter that says otherwise is worse than no counter.

const ENDPOINT = '/api/v1/t';

export interface BeaconEvent {
  surface: string;
  name?: string;
  entityKind?: string;
  entitySlug?: string;
  props?: Record<string, string>;
}

// send —— one event, best effort.
export function send(event: BeaconEvent): void {
  try {
    post(JSON.stringify(body(event)));
  } catch {
    // Instrumentation never interrupts a visit. There is nothing useful to do with this.
  }
}

function body(event: BeaconEvent): Record<string, unknown> {
  return {
    surface: event.surface,
    name: event.name ?? '',
    entity_kind: event.entityKind ?? '',
    entity_slug: event.entitySlug ?? '',
    props: event.props ?? {},
    url: window.location.pathname + window.location.search,
    referrer: document.referrer,
    title: document.title,
    screen: `${window.screen.width}x${window.screen.height}`,
    language: navigator.language,
  };
}

// post —— sendBeacon survives the page being closed, which a plain fetch does not: the dwell and
// read-complete events fire exactly when the visitor is leaving.
function post(payload: string): void {
  const blob = new Blob([payload], { type: 'application/json' });
  if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(ENDPOINT, blob)) {
    return;
  }
  void fetch(ENDPOINT, {
    method: 'POST', body: payload, keepalive: true,
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => undefined);
}

// SCROLL_MARKS —— the depths worth knowing. Four numbers, because the question an owner asks is
// "did they read it", and 25/50/75/100 answers that without pretending to more resolution than
// a scroll position has.
const SCROLL_MARKS = [25, 50, 75, 100] as const;

// watchScroll —— reports each depth once, and read-complete when the end is reached.
//
// Returns its own teardown. Every listener is passive, so none of this can delay a scroll.
export function watchScroll(event: BeaconEvent): () => void {
  const seen = new Set<number>();
  const onScroll = () => {
    const depth = scrollDepth();
    // A page with nothing to scroll reports nothing. Treating "no scrollbar" as "read to the
    // end" fires all four thresholds the instant the page mounts, which buries the events that
    // mean something under four that mean "this page was short".
    if (depth === null) return;
    for (const mark of SCROLL_MARKS) {
      if (depth >= mark && !seen.has(mark)) {
        seen.add(mark);
        send({ ...event, name: 'scroll_depth', props: { depth: String(mark) } });
      }
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return () => window.removeEventListener('scroll', onScroll);
}

// scrollDepth —— how far down the page the viewport has reached, as a percentage. Null when
// there is nothing to scroll, which is a different fact from "scrolled to 0%".
function scrollDepth(): number | null {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  if (scrollable <= 0) return null;
  return Math.round((window.scrollY / scrollable) * 100);
}
