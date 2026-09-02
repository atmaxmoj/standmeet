// use-connector-card —— the assembly lifecycle for one connector card
// (built-in or uploaded). Reads the derived credentials form + status; the
// owner fills in credentials in the UI → Connect: credentials get saved
// first, then the connection starts. oauth2 → the backend hands back
// auth_url → the same tab redirects through the dance → the callback
// exchanges the token → redirects back to /admin/connectors → the card
// becomes Connected. Non-dance (bearer/apikey) → connects the instant it's
// saved, no redirect. Disconnect → clears the token (keeps the credentials). Logic lives here; the card only renders.

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const StatusSchema = z.object({
  connected: z.boolean(),
  has_credentials: z.boolean().nullish(),
  // unreadable / reason —— this instance can no longer decrypt this row's
  // ciphertext (the instance key was rotated / the ciphertext was tampered
  // with). F-C-41. This kind of row used to 500 the whole status and list
  // endpoints, so the card rendered as "you've never connected" + a row of
  // empty boxes — a false statement about the world, while the ciphertext and connected_at were still sitting in the database.
  unreadable: z.boolean().nullish(),
  reason: z.string().nullish(),
});
const FormSchema = z.object({
  auth_type: z.string(),
  fields: z.array(z.object({ key: z.string() })).nullish(),
  scopes: z.array(z.string()).nullish(),
  schemes: z.array(z.string()).nullish(),
  // granted_scopes —— the ones **already granted** (`scopes` is what this
  // connector **supports**). The two must be kept separate before a
  // checkbox can even be pre-checked; the backend used to not report this at
  // all, so an active connection looked like it had zero permissions (F-C-33).
  granted_scopes: z.array(z.string()).nullish(),
  // shortfall —— **actions this grant can't do** + which scope each one is
  // still missing (F-B-8). `connected` says "there's a token in hand", and
  // the owner reads it as "this connection can do what it's asked to do" —
  // the two diverge the moment only read-only was granted, and the card used to say nothing about it at all.
  shortfall: z.array(z.object({
    operation: z.string(),
    needs: z.array(z.string()).nullish(),
  })).nullish(),
});
const ConnectSchema = z.object({
  auth_url: z.string().nullish(),
  connected: z.boolean(),
  error: z.string().nullish(),
});

export interface ConnectorCardHook {
  authType: string;
  fields: readonly string[];
  scopes: readonly string[];
  /** The scopes already granted. `scopes` is the optional list; this is which ones were actually granted — checkboxes read this (F-C-33). */
  granted: readonly string[];
  /** The scopes this grant is missing (deduplicated names). Empty = every declared action can be done. */
  missingScopes: readonly string[];
  schemes: readonly string[];
  connected: boolean;
  /** The backend says this connector already has credentials stored. The value itself never comes back — the card says "present" on that basis, rather than showing empty boxes. */
  hasCredentials: boolean;
  /** This instance can no longer read these credentials (F-C-41). Empty string = normal. Non-empty = the sentence telling the owner to reconnect. */
  unreadable: string;
  /**
   * This card **already knows what kind of connection it is**
   * (`/credential-form` has returned).
   *
   * Who needs it: Connect branches on `authType` — oauth2 goes through the
   * dance, everything else connects in place. `authType` is an empty string
   * before the form returns, so clicking during that frame sends an oauth2
   * connector down the bearer path instead, getting back "The connection
   * test failed." — a sentence that **belongs to the other path** (F-C-60).
   *
   * Why not just check `authType !== ''`: that would treat a value's content
   * as the readiness signal. What `auth_type` a connector declares is its
   * own business, and the day one declares an empty value, Connect could
   * never be pressed again. Readiness is "has it been asked", independent of what the answer looks like.
   */
  ready: boolean;
  connecting: boolean;
  error: string;
  /**
   * Asks the backend for this card's status again (F-C-45).
   *
   * Who needs it: the owner operations on the card (probe, send a test
   * email) **can change connection state** — run a probe after
   * deauthorizing, and the backend marks that row disconnected right away.
   * The card's `connected`, meanwhile, is whatever was fetched on page load,
   * so the same screen can say "connected" in one place and "authorization
   * was revoked" in another, and one of them is false.
   *
   * Why not branch by error category: state's home is the backend, and the
   * card just **asks again after an action**. Making every operation
   * separately remember "this kind of failure needs to notify the card" is a rule the next operation will forget.
   */
  reloadStatus: () => void;
  setField: (key: string, value: string) => void;
  setScope: (scope: string, checked: boolean) => void;
  connect: () => void;
  disconnect: () => void;
}

const SESSION_KEY = 'sm_connecting';

// useConnectorStatus —— the "status" group for a card: connected or not /
// credentials stored or not / whether this instance can still decrypt it.
//
// All three come from **the same endpoint** (`/status`), so they were pulled
// out together — the main hook hit the 70-line cap, and the gate pointed in
// the right direction: the assembly lifecycle (fill in credentials → connect
// → dance → disconnect) and "what state is this card in right now" are two different things.
function useConnectorStatus(id: string) {
  const [connected, setConnected] = useState(false);
  // hasCredentials —— the backend has always returned this
  // (`connector-security` verified it: status only ever returns
  // `has_credentials: true`, the credentials themselves never come back).
  // This hook used to **fetch it and throw it away**, so the card could only
  // show a row of empty boxes — the owner couldn't tell "stored but hidden"
  // apart from "nothing configured at all" (UX-65). Never returning the
  // value is correct (stronger secrecy than masking), but that means the UI
  // must be the one to state the fact that something is "present".
  const [hasCredentials, setHasCredentials] = useState(false);
  // unreadable —— this instance can no longer decrypt this ciphertext (the instance key was rotated / the ciphertext was tampered with). F-C-41.
  const [unreadable, setUnreadable] = useState('');

  const loadStatus = useCallback(() => {
    void adminAPI.get(`/connectors/${id}/status`, StatusSchema)
      .then((s) => {
        setConnected(s.connected);
        setHasCredentials(s.has_credentials === true);
        setUnreadable(s.unreadable === true ? (s.reason ?? '') : '');
        // Connected → clears the "connecting" flag, so a future connect_error elsewhere doesn't mistakenly land on this card.
        s.connected && clearConnecting(id);
      })
      .catch(() => undefined);
  }, [id]);

  return { connected, hasCredentials, unreadable, setConnected, loadStatus };
}

export function useConnectorCard(id: string): ConnectorCardHook {
  const [authType, setAuthType] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  // granted —— the scopes **already granted** by this connection (the checkboxes' initial state).
  const [granted, setGranted] = useState<string[]>([]);
  // missingScopes —— the names needed for the card's "what this grant can't do" sentence (F-B-8).
  const [missingScopes, setMissingScopes] = useState<string[]>([]);
  const [schemes, setSchemes] = useState<string[]>([]);
  // formLoaded —— whether the derived form has been fetched back. See ConnectorCardHook.ready.
  const [formLoaded, setFormLoaded] = useState(false);
  const status = useConnectorStatus(id);
  const { connected, hasCredentials, unreadable, setConnected, loadStatus } = status;
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  // values / chosen —— what the owner is currently **editing**, living only
  // on this screen. They aren't server state: what's typed in isn't sent until the moment Connect is pressed (F-C-46).
  const values = useRef<Record<string, string>>({});
  const chosen = useRef<Set<string>>(new Set());

  const loadForm = useCallback(() => {
    // Switching to a different card resets it back to "not known yet" — otherwise the previous card's readiness would vouch for this one.
    setFormLoaded(false);
    void adminAPI.get(`/connectors/${id}/credential-form`, FormSchema)
      .then((f) => {
        setAuthType(f.auth_type);
        setFields((f.fields ?? []).map((x) => x.key));
        setScopes(f.scopes ?? []);
        setSchemes(f.schemes ?? []);
        // What's already granted is **the starting point for the next
        // save**: when the owner wants to add a scope, what gets sent must
        // be "existing + newly checked", not "only newly checked" — otherwise merely glancing at the panel would quietly shrink the grant.
        const granted = f.granted_scopes ?? [];
        chosen.current = new Set(granted);
        setGranted(granted);
        setMissingScopes(distinctNeeds(f.shortfall ?? []));
        setFormLoaded(true);
      })
      // A failed form fetch must not be silent: otherwise the card is blank, and the owner can't fill in credentials or know why.
      .catch(() => setError('Couldn’t load this connector’s setup form. Reload and retry.'));
  }, [id]);

  useEffect(() => { loadStatus(); loadForm(); }, [loadStatus, loadForm]);

  // The dance's return trip carries ?connect_error=1 → lands on the card
  // that was "connecting" (the id remembered in sessionStorage), showing a
  // friendly error (copy that leaks no underlying error code / stack). The flag is cleared once this settles.
  useEffect(() => {
    const failed = new URLSearchParams(window.location.search).get('connect_error') === '1';
    if (failed && window.sessionStorage.getItem(SESSION_KEY) === id) {
      setError('The connection didn’t complete. Check your credentials and try again.');
      clearConnecting(id);
    }
  }, [id]);

  // saveCreds —— saves what's being edited on this screen. **It is the
  // submit point, and keystrokes are not** (F-C-46).
  //
  // It used to save on every keystroke. Two individually correct rules
  // collided as a result: the server clears connected the moment
  // credentials genuinely change (D-5 / F-C-30), so the instant the owner
  // **started** changing a password, the still-in-use connection was
  // already marked disconnected — the emails that send codes, the booking
  // confirmations, stopped right there, while the card still said connected.
  // Anyone who stepped away mid-edit, or gave up partway through, was left with a broken connection.
  //
  // Now only Connect calls it: saving is immediately followed by
  // verification, so the rule "changed means re-verify" still holds, just
  // landing at the moment the owner explicitly submits. It returns a promise
  // — Connect must wait for it to land: the connector's row in the database
  // is created by this very write (the backend marking a nonexistent row as connected would turn green over an empty database).
  const saveCreds = useCallback(() => {
    // **Don't save if nothing was typed at all**: an empty write would still
    // create the connector's row, and connect's UPDATE reports "connected"
    // as soon as it hits a row — so "connected" would get said even when
    // nothing was filled in (this is exactly what connector-connect-receipt
    // pins down). Saving used to be tied to keystrokes, so an empty save was
    // never possible; moving the submit point to Connect makes it possible.
    if (Object.keys(values.current).length === 0 && chosen.current.size === 0) {
      return Promise.resolve();
    }
    // A failed save must be loud: otherwise the owner thinks credentials are
    // saved, clicks Connect, and the connection fails using unsaved
    // credentials, leaving them baffled. connect() calls setError('') at the
    // start, so this save error clears naturally the next time Connect is clicked.
    return adminAPI.postVoid(`/connectors/${id}/credentials`, {
      ...values.current, scopes: [...chosen.current],
    }).catch(() => setError('Couldn’t save credentials — check your connection and retry.'));
  }, [id]);

  const connect = useCallback(() => {
    // With the form not back yet, there's no "which branch" to pick — the
    // button is disabled at this point, and this check is the second line
    // of defense: keyboard/script/race conditions can still trigger a
    // click, and the cost of picking the wrong branch is an oauth2
    // connector reading a failure sentence that belongs to the non-dance path.
    if (!formLoaded) return;
    setError('');
    // Flips to "connecting…" synchronously: there's immediate feedback on
    // click, and the state leaves "not connected" right away ("connecting"
    // doesn't match /^connected$/, so an assertion still genuinely waits for the return trip).
    setConnecting(true);
    // Waits for its own credential save to land first, then starts the
    // connection — both paths need this wait: the non-dance connect needs a
    // row to mark, oauth2's dance needs client_id/secret readable server-side.
    const go = authType === 'oauth2'
      ? () => startDance(id, { setConnecting, setError })
      : () => runNonDanceConnect(id, { setConnecting, setConnected, setError });
    void saveCreds().then(go);
  }, [id, authType, formLoaded, setConnected, saveCreds]);

  const disconnect = useCallback(() => {
    void adminAPI.postVoid(`/connectors/${id}/disconnect`, {})
      .then(() => { setConnected(false); setError(''); })
      // A failed disconnect must not be silent: otherwise the owner thinks it's disconnected, but the card is still connected — state doesn't match reality.
      .catch(() => setError('Couldn’t disconnect — check your connection and retry.'));
  }, [id, setConnected]);

  return {
    authType, fields, scopes, granted, missingScopes, schemes, connected, hasCredentials,
    unreadable, ready: formLoaded, connecting, error, reloadStatus: loadStatus,
    // Only recorded on this screen, never sent out — the submit point is Connect (F-C-46).
    setField: (k, v) => { values.current[k] = v; },
    setScope: (s, on) => { on ? chosen.current.add(s) : chosen.current.delete(s); },
    connect, disconnect,
  };
}

// distinctNeeds —— merges the missing scope from every action that can't be
// done into one deduplicated list. What the owner needs to do is "add these
// and reconnect", not read through action by action.
function distinctNeeds(
  rows: readonly { needs?: readonly string[] | null }[],
): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    for (const s of r.needs ?? []) seen.add(s);
  }
  return [...seen];
}

// clearConnecting —— clears this card's "connecting" flag (only when the id it recorded is this one).
function clearConnecting(id: string): void {
  if (window.sessionStorage.getItem(SESSION_KEY) === id) {
    window.sessionStorage.removeItem(SESSION_KEY);
  }
}

// startDance —— oauth2: records "connecting this id" → POST connect to get
// auth_url → redirects the whole page through the dance.
// Missing auth_url → resets connecting + reports the error. (connecting is
// already flipped synchronously by connect() at the moment of the click;
// this doesn't flip it again: it needs to happen before "wait for the
// credential save to land", or the click would have a gap with no feedback.)
function startDance(
  id: string, set: { setConnecting: (b: boolean) => void; setError: (s: string) => void },
): void {
  window.sessionStorage.setItem(SESSION_KEY, id);
  void adminAPI.post(`/connectors/${id}/connect`, {}, ConnectSchema)
    .then((r) => {
      const url = r.auth_url ?? '';
      url === '' ? set.setConnecting(false) : (window.location.href = url);
    })
    .catch(() => { set.setConnecting(false); set.setError('The connection could not be completed.'); });
}

// runNonDanceConnect —— non-oauth2 (bearer/apikey): credentials have already
// landed (connect() waited for it) → starts the connection directly, no
// redirect, flips state in place. When connected:false the backend always
// gives a reason (connection test failed / credentials not yet saved); it's displayed as-is.
function runNonDanceConnect(
  id: string,
  set: {
    setConnecting: (b: boolean) => void;
    setConnected: (b: boolean) => void;
    setError: (s: string) => void;
  },
): void {
  void adminAPI.post(`/connectors/${id}/connect`, {}, ConnectSchema)
    .then((r) => {
      set.setConnecting(false);
      set.setConnected(r.connected);
      set.setError(r.connected ? '' : (r.error ?? 'The connection test failed.'));
    })
    .catch(() => { set.setConnecting(false); set.setError('The connection could not be completed.'); });
}
