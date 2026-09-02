// redirect-uri.ts —— the connector's callback address that gets "registered
// with the SaaS" (F-C-32).
//
// This value's **only** use is being pasted into a third party's console
// under "Authorized redirect URIs", and that field only accepts an
// **absolute** address: Google / Notion / anyone will reject a relative path
// like `/api/...` outright. The card used to hardcode the path directly, so
// this control couldn't do the one thing it's there for.
//
// The origin in the absolute address **can only be supplied by the running
// instance**: the owner's domain and port are only known at deploy time, and
// the same instance may be reachable at several addresses (localhost, LAN,
// public domain). The one that needs registering is exactly the one the
// owner is **using to view this page right now** — hence `window.location.origin`, never a constant.

import { useEffect, useState } from 'react';

/** connectorCallbackPath —— the callback's path on this instance (the half after the origin). */
export function connectorCallbackPath(connectorID: string): string {
  return `/api/admin/connectors/${connectorID}/callback`;
}

/**
 * useConnectorRedirectURI —— the full, paste-ready callback address.
 * SSR has no window, so the path is given first (renders something, without
 * pretending it's a URI); it's swapped for the absolute address after mount.
 */
export function useConnectorRedirectURI(connectorID: string): string {
  const path = connectorCallbackPath(connectorID);
  const [uri, setURI] = useState(path);
  useEffect(() => setURI(`${window.location.origin}${path}`), [path]);
  return uri;
}
