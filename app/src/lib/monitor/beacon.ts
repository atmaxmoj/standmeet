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

import { readConsent } from '@/lib/monitor/consent';

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
  // Opt-in consent gate (GDPR): nothing leaves the browser until the visitor accepts. TrackVisit
  // already withholds the install until then; this is the belt-and-braces at the one network call,
  // so any future caller of send() inherits the same guarantee for free.
  if (readConsent() !== 'accepted') return;
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
export function watchScroll(event: BeaconEvent, onEnd?: () => void): () => void {
  const seen = new Set<number>();
  const onScroll = (e?: Event) => {
    // Only the page's own scroller counts. A page has other scrollable things on it — the tree
    // rail, a wide table, a code block — and reading one of those to its end is not reading the
    // article to its end. Without this, dragging the tree rail down would report "read 100%".
    if (e !== undefined && !isPageScroller(e.target)) return;
    const depth = scrollDepth(e?.target);
    // A page with nothing to scroll reports nothing. Treating "no scrollbar" as "read to the
    // end" fires all four thresholds the instant the page mounts, which buries the events that
    // mean something under four that mean "this page was short".
    if (depth === null) return;
    for (const mark of SCROLL_MARKS) {
      if (depth >= mark && !seen.has(mark)) {
        seen.add(mark);
        send({ ...event, name: 'scroll_depth', props: { depth: String(mark) } });
        mark === 100 && onEnd?.();
      }
    }
  };
  // On `document`, in the capture phase, rather than on `window`.
  //
  // The page is not always what scrolls. The corpus reader's shell is `h-dvh overflow-hidden`
  // with the article in an inner `overflow-y-auto` column (app/src/app/wiki/layout.tsx) — a
  // deliberate choice, so the tree rail can stay put while the body moves. A window listener
  // hears nothing there: `window.scrollY` stays 0 for a reader who read every word, and the
  // depth histogram for the entire corpus reads empty while looking perfectly healthy.
  //
  // Scroll events do not bubble, but they DO reach `document` in the capture phase, so this one
  // listener hears every scroller on the page and asks the event which element moved. The
  // watcher stops guessing at the layout, and a future layout change cannot silence it again.
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  onScroll();
  return () => document.removeEventListener('scroll', onScroll, { capture: true });
}

// watchRead —— what a reading page reports on top of scroll depth: reaching the end, and how
// long the visitor stayed.
//
// Separate from watchScroll because "read to the end" only means something on a page that has an
// end. The index is a scroll surface too, and firing read-complete there would put "someone
// scrolled past the footer" on the same list as "someone finished an article".
export function watchRead(event: BeaconEvent): () => void {
  const stopScroll = watchScroll(event, () => send({ ...event, name: 'read_complete' }));
  const stopDwell = watchDwell(event);
  return () => { stopScroll(); stopDwell(); };
}

// DWELL_BUCKETS —— seconds, reported as a bucket rather than a number.
//
// A bucket, because the raw seconds are both noisier and more identifying than the question
// deserves: an owner asks "did they actually read it", and "2-10s / 10-30s / 30s-2m / 2m+"
// answers that. A per-visitor stopwatch reading answers a question nobody asked.
const DWELL_BUCKETS: readonly { atLeast: number; label: string }[] = [
  { atLeast: 120, label: '2m+' },
  { atLeast: 30, label: '30s-2m' },
  { atLeast: 10, label: '10-30s' },
  { atLeast: 2, label: '2-10s' },
];

// watchDwell —— reports once, when the page is hidden.
//
// `visibilitychange`, not `beforeunload`: a phone switching apps and a tab being closed both fire
// it, and mobile browsers routinely never fire beforeunload at all. Once per page — a visitor
// switching tabs four times is one read, and a counter that says four is worse than none.
function watchDwell(event: BeaconEvent): () => void {
  const started = Date.now();
  let sent = false;
  const onHide = () => {
    if (sent || document.visibilityState !== 'hidden') return;
    const seconds = Math.round((Date.now() - started) / 1000);
    const bucket = DWELL_BUCKETS.find((b) => seconds >= b.atLeast);
    // Under two seconds is a bounce, not a dwell, and recording it as one would put every
    // mis-click on the reading list.
    if (bucket === undefined) return;
    sent = true;
    send({ ...event, name: 'read_dwell', props: { dwell: bucket.label } });
  };
  document.addEventListener('visibilitychange', onHide);
  return () => document.removeEventListener('visibilitychange', onHide);
}

// scrollDepth —— how far down the scroller has reached, as a percentage. Null when there is
// nothing to scroll, which is a different fact from "scrolled to 0%".
//
// `target` is whatever the scroll event named; with no event (the initial call) it is the page.
// A scroll on `document` reports the document as its target, and the element carrying the
// measurements is then documentElement.
function scrollDepth(target?: EventTarget | null): number | null {
  const el = scrollerOf(target);
  const scrollable = el.scrollHeight - el.clientHeight;
  if (scrollable <= 0) return null;
  return Math.round((el.scrollTop / scrollable) * 100);
}

function scrollerOf(target?: EventTarget | null): Element {
  return target instanceof Element ? target : document.documentElement;
}

// isPageScroller —— is this the element the ARTICLE scrolls in.
//
// Defined by containment rather than by a selector, so it holds across the two reader shells and
// whatever a third one does: the page scroller is the document itself, or an element that
// contains the page's `<main>`. The tree rail is an `<aside>` and contains no main; a code block
// or wide table is contained BY main rather than containing it. Both are correctly ignored.
function isPageScroller(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true; // the document itself
  const main = document.querySelector('main');
  return target === document.documentElement || target === document.body
    || (main !== null && target.contains(main));
}
