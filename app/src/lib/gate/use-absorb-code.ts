// use-absorb-code —— the entry point for a visitor arriving with
// `?code=ABC` in the URL.
//
// Runs once on mount: pulls the code from the URL into usePendingCodeStore,
// then immediately does history.replaceState to strip the query (so the
// plaintext code doesn't stay in the URL / history / screenshots / referer).
//
// **Does not issue a session here** (defer-issue): scanning the code only
// stores it for now; the name picker (use-issue-pending-code) is what
// actually calls issueCodeSession, once the visitor has picked a name —
// that way the name genuinely lands in the backend = one person = one
// named member = one continuable chat. Skip goes through that same path
// too (anonymous issue).
//
// Security: `?code=` in the URL is not safe (screenshots / sharing /
// referer / history can all leak the plain code), so the entry point does
// replaceState immediately to remove it, stashing the code in an in-memory
// store instead.

'use client';

import { useEffect } from 'react';

import { loadStoredSession } from '@/lib/gate/use-gate';
import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';
import { codeLandingHref } from '@/lib/visitor/code-landing';
import { peekStoredSession } from '@/lib/visitor/session-store';
import { clearNameDismiss } from '@/lib/visitor/visitor-name';

export function useAbsorbCodeFromURL(): void {
  useEffect(() => {
    absorbFromURL();
  }, []);
}

// absorbFromURL —— runs once: reads the code from location.search, sets it
// into the pending store, then history.replaceState removes the code from
// the query (keeping the rest of the query/hash intact).
function absorbFromURL(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if (code === null || code === '') return;
  // F-A-5: already in a named session for **this same code** (via /gate or
  // having previously picked a name) = the visitor is already resolved →
  // reopening the ?code= link shouldn't pop the identity picker over an
  // active session. The code still gets stripped from the URL either way.
  if (!alreadyInNamedSession(code)) {
    usePendingCodeStore.getState().setCode(code);
    // A new code (scanning a QR / clicking a shared link) = a new scenario
    // → clear the previous skip's 30-day dismissal so VisitorNamePicker
    // asks for a name again.
    clearNameDismiss();
  }
  url.searchParams.delete('code');
  const rest = url.searchParams.toString();
  const next = url.pathname + (rest ? `?${rest}` : '') + url.hash;
  window.history.replaceState(null, '', next);
  landOnRendering(code);
}

// landOnRendering —— opening the same link a second time (already in a
// named session for this code, so the branch above returns early and never
// issues again) still needs to land on this code's page.
//
// The landing target was stored in the session at issuance, so this reads
// the same fact rather than recomputing it. **Miss this branch and the bug
// only shows up on a "return visit"**: the first scan works fine, but
// clicking the same link a second time lands on the default chat instead —
// and since the owner only has one code, testing it once won't catch it.
function landOnRendering(code: string): void {
  if (!alreadyInNamedSession(code)) return;
  const href = codeLandingHref(loadStoredSession()?.custom_page_slug ?? '');
  if (href === '' || window.location.pathname === href) return;
  window.location.assign(href);
}

// alreadyInNamedSession —— whether there's already an active session that's
// **for this same code and already named**. peekStoredSession reads
// localStorage synchronously, sidestepping zustand hydrate timing (which
// mounts at the same time as the absorb effect).
function alreadyInNamedSession(code: string): boolean {
  const active = peekStoredSession();
  return active?.code === code && Boolean(active?.visitor);
}
