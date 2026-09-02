// status —— the status enum shared by every store. Each resource store has
//   - idle:     not fetched yet (ensureLoaded triggers the first pull)
//   - loading:  currently fetching (first load or an explicit refresh)
//   - ready:    has data; may also carry error (partial failure, stale data stays)
//   - error:    fetch failed and there's no cached data
//
// Previously 13 hooks each invented their own shape; now every store speaks
// this one vocabulary.
//
// A discriminated union on state.kind gets verbose for the simple four-state
// idle/loading/error/ready case, so this flattens it into a status flag plus
// optional data plus optional error fields; both the selector pattern and the
// skeleton pattern read more smoothly this way.

export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ResourceShape<T> {
  status: ResourceStatus;
  data: T | undefined;
  error: string | null;
  // errorStatus —— the HTTP status code of the failed request (null for a
  // non-APIError failure, e.g. the network dropped).
  //
  // Why this gets its own field: **"not authorized" and "server is down" are
  // not the same thing**, and their remedies are opposite (401 → go log in;
  // 500 → logging in won't help, wait for the service to come back). With
  // only a message string, the reader can only treat every failure as one
  // class — that's exactly how F-N-2 rendered a 500 as "you're not logged in"
  // and bounced the owner to the login page. The information was already
  // there (`APIError.status`); it just got dropped at this layer.
  errorStatus: number | null;
  lastFetched: number | null; // Date.now() at last successful fetch; null if never fetched
}
