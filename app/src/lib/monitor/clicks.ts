// clicks —— the in-page interactions the backend cannot see, observed rather than called.
//
// Same principle as monitor/mw next door: ONE delegated listener watches the document, and no
// component is edited to add a measurement. A reader component does not gain an onClick, does not
// gain a prop, and cannot lose a measurement by someone refactoring a handler that never
// mentioned measurement.
//
// The hook is the `data-testid`, which is already a contract in this codebase (a gate enforces
// that testids sit on real DOM elements). Reusing it means the rule and the element move
// together: rename the testid and the rule stops matching, which a test can see — whereas a
// deleted onClick leaves nothing at all to look at.
//
// Each rule names the SURFACE it reports on, not the page it is installed on. A citation link is
// a chat interaction whether the visitor is in the chat room or in the reader's chat rail, and
// keying it on the page would file the same click under two surfaces.

import { send, type BeaconEvent } from '@/lib/monitor/beacon';

interface ClickRule {
  // selector —— matched against the clicked element and its ancestors, so a click on a <span>
  // inside a link still counts as a click on the link.
  selector: string;
  surface: string;
  name: string;
  // when —— an extra condition read off the element at click time. A tree toggle is both
  // "expand" and "collapse"; only one of them is an event.
  when?: (el: Element) => boolean;
  props?: (el: Element) => Record<string, string>;
}

const RULES: readonly ClickRule[] = [
  {
    selector: '[data-testid="related-rail-read-next"] a',
    surface: 'reader', name: 'related_click',
    props: (el) => ({ to: href(el) }),
  },
  {
    selector: '[data-testid="related-rail-cited-by"] a',
    surface: 'reader', name: 'cited_by_click',
    props: (el) => ({ to: href(el) }),
  },
  {
    selector: '[data-testid="language-switch"] a',
    surface: 'reader', name: 'lang_switch',
    props: (el) => ({ lang: el.getAttribute('hreflang') ?? '' }),
  },
  {
    // Only the opening half. A collapse is not a reader showing interest in a branch, and
    // counting both would make "which branches get opened" a count of fidgeting.
    selector: '[data-testid^="tree-toggle-"]',
    surface: 'reader', name: 'tree_expand',
    when: (el) => el.getAttribute('aria-expanded') === 'false',
    props: (el) => ({ path: suffix(el, 'tree-toggle-') }),
  },
  {
    // The citation list under an answer. `data-citation-path` is on the anchor already — the
    // panel gets which entry was opened, not just that something was.
    selector: '[data-testid="citation-row"]',
    surface: 'chat', name: 'source_click',
    props: (el) => ({ path: el.getAttribute('data-citation-path') ?? '' }),
  },
];

// watchClicks —— installs the one listener. Returns its own teardown.
//
// Capture phase: a rule must still fire for a link that navigates away, and by the time a bubbled
// listener runs, another handler may already have called preventDefault or started a client-side
// navigation that unmounts the element the props are read from.
export function watchClicks(base: BeaconEvent): () => void {
  const onClick = (e: Event) => fire(e, base);
  document.addEventListener('click', onClick, { capture: true, passive: true });
  return () => document.removeEventListener('click', onClick, { capture: true });
}

function fire(e: Event, base: BeaconEvent): void {
  const target = e.target;
  if (!(target instanceof Element)) return;
  for (const rule of RULES) {
    const el = target.closest(rule.selector);
    if (el === null || rule.when?.(el) === false) continue;
    send({
      ...base, surface: rule.surface, name: rule.name, props: rule.props?.(el) ?? {},
    });
  }
}

// href —— a link's path, never its full URL. The panel groups by path, and an absolute URL from
// one instance would not group with the same entry read on another.
function href(el: Element): string {
  const raw = el.getAttribute('href') ?? '';
  try {
    return new URL(raw, window.location.origin).pathname;
  } catch {
    return raw;
  }
}

// suffix —— the variable half of a testid like `tree-toggle-projects/lucerna`.
function suffix(el: Element, prefix: string): string {
  return (el.getAttribute('data-testid') ?? '').slice(prefix.length);
}
