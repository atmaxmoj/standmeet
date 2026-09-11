// track —— the tracking install, lifted out of the TrackVisit component so the presentation layer
// holds no branching (its lint forbids `if` / complexity there): whether consent is given, whether
// to send the view, and which depth watcher to attach are all data decisions, and belong here.

import { send, watchScroll, watchRead, type BeaconEvent } from '@/lib/monitor/beacon';
import { watchClicks } from '@/lib/monitor/clicks';
import type { Consent } from '@/lib/monitor/consent';

export interface TrackOptions {
  scroll?: boolean;
  read?: boolean;
  view?: boolean;
}

// installTracking —— send the view + attach the watchers, returning a teardown. Returns undefined
// (no-op cleanup) when consent has not been given: opt-in means nothing is installed or sent until
// the visitor accepts. Called from an effect keyed on consent, so accepting re-runs it.
export function installTracking(
  consent: Consent, event: BeaconEvent, opts: TrackOptions,
): (() => void) | undefined {
  if (consent !== 'accepted') return undefined;
  // The view first, so a visitor who leaves immediately is still a visitor.
  opts.view === false || send(event);
  // Click rules install on every tracked page; a rule whose element isn't here simply never matches.
  const stopClicks = watchClicks(event);
  const stopScroll = depthWatcher(opts.read, opts.scroll)?.(event);
  return () => { stopClicks(); stopScroll?.(); };
}

// depthWatcher —— which scroll watcher this page wants, or none. `read` implies `scroll`: a page
// with an end is a page that scrolls, and making the caller pass both risks a reading page that
// reports completion but no depth.
function depthWatcher(read?: boolean, scroll?: boolean) {
  return read === true ? watchRead : scroll === true ? watchScroll : null;
}
