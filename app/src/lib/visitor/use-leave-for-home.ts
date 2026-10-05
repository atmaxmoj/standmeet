// use-leave-for-home —— a dead session can make the app answer `/` or a `/c/<slug>` chat: the
// middleware routes on the session's cookie, never the session itself. Once that session is cleared
// and nothing is left to show but the identity fallback, the visitor is a public one: load `/` again,
// now without the session, so the owner's home page answers (sijie.xyz, 2026-10-05: a revoked code's
// visitor came back to `/` and never reached the home page).
//
// Leaves only when this tab's session just ended (takeEndedSession, read once): the first render,
// before the stored session is read back, is the fallback too and must not move a live visitor; a
// page that is the fallback anyway (no home page live) never loops.

'use client';

import { useEffect } from 'react';

import { takeEndedSession } from '@standmeet/sdk';

export function useLeaveForHome(fallback: boolean, session: unknown): void {
  useEffect(() => {
    if (fallback && takeEndedSession()) window.location.replace('/');
  }, [fallback, session]);
}
