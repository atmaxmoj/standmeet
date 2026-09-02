// server-log —— the logging exit point for **the app process itself**
// (route handler / server component).
//
// Why not reuse `@/lib/logger`: that one is the exit point for the
// **browser** side, mute by default in prod (needs NEXT_PUBLIC_CLIENT_LOG
// explicitly turned on). Something running server-side must always speak up —
// it records "what happened at this hop", and the container log is the only
// place that's readable.
//
// Why this is needed (F-O-3): the `/api/v1/agent/turn` hop is a hand-written
// reverse proxy inside the app. When a cross-origin request intermittently
// fails entirely on its first round, **there's nothing in the backend logs**
// (the request never reached the backend), and there's nothing on the app
// side either — the only clue left is a misleading CORS error in the browser
// console. Without instrumentation, all you can do is guess, and needing to
// guess is itself the defect ([[no-diagnosis-by-experiment]]).
//
// The shape matches the backend's slog (one JSON object per line), so both
// sides' logs can be read on the same timeline.

/* eslint-disable no-console */

export function serverLog(
  level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...fields });
  level === 'error' ? console.error(line) : console.log(line);
}
