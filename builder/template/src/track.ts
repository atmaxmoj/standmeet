// track.ts — traffic instrumentation for every microsite build, including the owner's homepage.
//
// It lives in the TEMPLATE, not in a widget and not in the owner's page, because of what a
// microsite is: owner-written React, edited freely, rebuilt on every save. Instrumentation put
// in that file would be deleted the first time the owner tidied their page, and its absence
// would look exactly like "nobody visited". Here it is part of the shell every build gets, and
// the owner cannot lose it by editing their own page.
//
// It observes the DOM rather than being called, for the same reason the server-side recorder is
// a middleware (backend/internal/monitor/mw/middleware.go): no widget gains an onClick, no
// widget can drop one, and the hook is the `data-testid` the widgets already carry as a
// contract. A renamed testid stops a rule matching, which a test can see; a deleted onClick
// leaves nothing to look at.
//
// Not recorded here: the page VIEW. The backend already sees the request that serves this build
// (`/microsites/{slug}`), and a beacon view on top would double every number on the panel —
// which is worse than a missing one, because it looks like success.

const ENDPOINT = '/api/v1/t';

// SURFACE — a microsite, always. This file only ever runs inside a microsite build, and the
// owner's homepage is one of those: it is the reserved `home` page served at `/`. Calling it
// something else here would put the same page under two surface names depending on the URL it
// was reached by.
const SURFACE = 'microsite';

interface Rule {
  selector: string;
  name: string;
  // event — 'click' or 'focusin'. Focus is how "someone considered asking a question" is
  // observed: the ask box navigates away on submit, so a submit-only count misses everyone who
  // opened it and thought better of it, which is the more interesting half.
  event: 'click' | 'focusin';
  props?: (el: Element) => Record<string, string>;
}

const RULES: readonly Rule[] = [
  {
    // A CorpusWidget card. `pin_click` is its name because on the homepage these ARE the
    // owner's pinned entries.
    selector: '[data-testid^="corpus-widget-card-"]',
    name: 'pin_click', event: 'click',
    props: (el) => ({ path: attr(el, 'data-testid').slice('corpus-widget-card-'.length) }),
  },
  {
    selector: '[data-testid="gate-widget"]',
    name: 'hero_cta_click', event: 'click',
    props: () => ({ cta: 'gate' }),
  },
  {
    // Any way out to a person: the owner writes these by hand, so they are matched by what they
    // ARE (a mail or phone link) rather than by a testid the owner never added.
    selector: 'a[href^="mailto:"], a[href^="tel:"], [data-contact]',
    name: 'contact_click', event: 'click',
    props: (el) => ({ channel: channelOf(el) }),
  },
  {
    selector: '[data-testid="agent-widget-input"]',
    name: 'chat_input_focus', event: 'focusin',
  },
];

// track — installs the listeners. Called once, from main.tsx.
export function track(): void {
  const entity = { entity_kind: 'microsite', entity_slug: siteSlug() };
  for (const kind of ['click', 'focusin'] as const) {
    document.addEventListener(kind, (e) => fire(kind, e, entity), { capture: true, passive: true });
  }
  watchScroll(entity);
}

function fire(kind: string, e: Event, entity: Record<string, string>): void {
  const target = e.target;
  if (!(target instanceof Element)) return;
  for (const rule of RULES) {
    const el = rule.event === kind ? target.closest(rule.selector) : null;
    el && send({ ...entity, name: rule.name, props: rule.props?.(el) ?? {} });
  }
}

// SCROLL_MARKS — the same four depths the first-party reader reports, so "how far down did
// people get" means one thing across the whole instance rather than two.
const SCROLL_MARKS = [25, 50, 75, 100];

function watchScroll(entity: Record<string, string>): void {
  const seen = new Set<number>();
  const onScroll = (e?: Event) => {
    // The page is not always what scrolls: an owner may lay their page out inside its own
    // `overflow-y-auto` column, and a window listener would then hear nothing while reporting
    // perfect health. Scroll events reach `document` in the capture phase, so one listener
    // hears every scroller and asks the event which element moved. Only the one holding the
    // page counts — scrolling a card or a wide table is not reading the page.
    const el = pageScroller(e?.target);
    if (el === null) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    // Nothing to scroll is not "read to the end". Reporting it would fire all four marks the
    // instant a short page mounts.
    if (scrollable <= 0) return;
    const depth = Math.round((el.scrollTop / scrollable) * 100);
    for (const mark of SCROLL_MARKS) {
      if (depth >= mark && !seen.has(mark)) {
        seen.add(mark);
        send({ ...entity, name: 'scroll_depth', props: { depth: String(mark) } });
      }
    }
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  onScroll();
}

// pageScroller — the element the PAGE scrolls in, or null when the event came from something
// else. The owner's page is mounted into #root, so the page scroller is the document itself or
// whatever element contains #root.
function pageScroller(target?: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return document.documentElement;
  const root = document.getElementById('root');
  const isPage = target === document.documentElement || target === document.body
    || (root !== null && target.contains(root));
  return isPage ? target : null;
}

// siteSlug — which page this build is. `/p/<slug>` names itself; anything else is the reserved
// homepage, which the instance serves at `/`.
function siteSlug(): string {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[0] === 'p' && parts[1] ? parts[1] : 'home';
}

function channelOf(el: Element): string {
  const href = attr(el, 'href');
  return href.startsWith('mailto:') ? 'email' : href.startsWith('tel:') ? 'phone' : 'link';
}

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? '';
}

// send — fire and forget. Nothing here is awaited and no failure is surfaced: a visitor must
// never see or feel analytics.
function send(event: Record<string, unknown>): void {
  try {
    post(JSON.stringify({
      surface: SURFACE,
      url: window.location.pathname + window.location.search,
      referrer: document.referrer,
      title: document.title,
      screen: `${window.screen.width}x${window.screen.height}`,
      language: navigator.language,
      ...event,
    }));
  } catch {
    // There is nothing useful to do with this.
  }
}

function post(payload: string): void {
  const blob = new Blob([payload], { type: 'application/json' });
  if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(ENDPOINT, blob)) return;
  void fetch(ENDPOINT, {
    method: 'POST', body: payload, keepalive: true,
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => undefined);
}
