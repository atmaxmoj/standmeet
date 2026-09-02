// logger —— the frontend's single console exit point.
//
// eslint has 'no-console: error' set, so business code can't call console.*
// directly. This file breaks that with eslint-disable so every client-side
// log funnels through here.
//
// Behavior:
//   - dev (NODE_ENV !== 'production') calls console.{info,warn,error} directly
//   - prod defaults to no-op; a separate NEXT_PUBLIC_CLIENT_LOG=1 flag can
//     force it on (used for e2e prod app diagnostics / live troubleshooting,
//     without needing to change NODE_ENV).
//   - could later add navigator.sendBeacon → /internal/client-errors
//
// Usage:
//   import { logger } from '@/lib/logger';
//   logger.error('handle update', err);
//
// `unknown` args are spread straight into console; callers don't need to
// worry about types.

/* eslint-disable no-console */

interface Logger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

// NEXT_PUBLIC_CLIENT_LOG is a separate build-time-inlined flag: on by
// default in dev, needs an explicit 1 in prod. Decoupled from NODE_ENV —
// so prod can also temporarily turn on client-side log troubleshooting.
function isDev(): boolean {
  if (process.env.NEXT_PUBLIC_CLIENT_LOG === '1') return true;
  return typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
}

export const logger: Logger = {
  info: (msg, ...args) => { isDev() && console.info(`[standmeet] ${msg}`, ...args); },
  warn: (msg, ...args) => { isDev() && console.warn(`[standmeet] ${msg}`, ...args); },
  error: (msg, ...args) => { isDev() && console.error(`[standmeet] ${msg}`, ...args); },
};
