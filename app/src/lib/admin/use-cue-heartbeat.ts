// use-cue-heartbeat —— while /cue is on screen, tell the server the owner is reading the cards here
// (POST /screen-assistant/viewing, owner session). The desktop cue app reads that presence
// (assistant.read's phone_present) and hands its display to the phone; when the phone locks or /cue
// is backgrounded the heartbeat stops, presence lapses in a few seconds, and the desktop takes over
// again. Only /cue beats, so the cards being open on the computer never blanks the desktop app.

import { useEffect } from 'react';

import { adminAPI } from '@/lib/api/admin';

// BEAT_MS —— faster than the server's viewerTTL (5s), so two beats fit inside it; a single dropped
// beat does not hand the display back mid-answer.
const BEAT_MS = 2_000;

export function useCueHeartbeat(): void {
  useEffect(() => {
    let stopped = false;
    const beat = () => {
      if (document.visibilityState !== 'visible') return; // locked / backgrounded: let presence lapse
      void adminAPI.postVoid('/screen-assistant/viewing', {}).catch(() => {});
    };
    beat();
    const timer = setInterval(() => {
      if (!stopped) beat();
    }, BEAT_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
}
