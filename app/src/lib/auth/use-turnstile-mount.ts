// use-turnstile-mount —— mount/unmount side effect for the Cloudflare
// Turnstile widget.
//
// Pulled out into a lib hook because the presentation layer
// (TurnstileWidget) isn't allowed to contain an imperative branch (`if`).
// All imperative widget API calls are centralized here:
//   1. insert the turnstile script tag into document.head once;
//   2. poll window.turnstile until it's ready;
//   3. call turnstile.render, forwarding the token callback to onToken;
//   4. call turnstile.remove to clean up the widget on unmount.

import { useEffect, useRef } from 'react';

import { logger } from '@/lib/logger';

interface TurnstileOpts {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

interface TurnstileAPI {
  render: (el: HTMLElement, opts: TurnstileOpts) => string;
  remove: (widgetID: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const POLL_INTERVAL_MS = 50;

export function useTurnstileMount(
  siteKey: string,
  onToken: (token: string) => void,
): React.RefObject<HTMLDivElement | null> {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const widgetIDRef = useRef<string | null>(null);

  useEffect(() => {
    const guard = { cancelled: false };
    void mount(siteKey, hostRef.current, widgetIDRef, onToken, guard);
    return () => {
      guard.cancelled = true;
      unmount(widgetIDRef);
    };
  }, [siteKey, onToken]);

  return hostRef;
}

async function mount(
  siteKey: string,
  host: HTMLDivElement | null,
  widgetIDRef: React.MutableRefObject<string | null>,
  onToken: (token: string) => void,
  guard: { cancelled: boolean },
): Promise<void> {
  siteKey && host && await mountWhenReady(siteKey, host, widgetIDRef, onToken, guard);
}

async function mountWhenReady(
  siteKey: string,
  host: HTMLDivElement,
  widgetIDRef: React.MutableRefObject<string | null>,
  onToken: (token: string) => void,
  guard: { cancelled: boolean },
): Promise<void> {
  ensureScript();
  await waitForTurnstile();
  const api = guard.cancelled ? null : window.turnstile;
  api && (widgetIDRef.current = renderWidget(api, host, siteKey, onToken));
}

// renderWidget —— render once, and **report the outcome**. Without this
// line, a challenge box that fails to render is just a blank space on the
// page: the visitor sees "pass this challenge to proceed" with nothing to
// click, and the console stays silent — leaving nothing but guesswork.
// The widget id is the only receipt this side of the product can get, so
// log it whether it comes back or not.
function renderWidget(
  api: TurnstileAPI, host: HTMLElement, siteKey: string, onToken: (t: string) => void,
): string | null {
  try {
    const id = api.render(host, buildOpts(siteKey, onToken));
    logger.info(`turnstile rendered widget id=${id}`);
    return id;
  } catch (e) {
    logger.error('turnstile render failed', e);
    return null;
  }
}

function buildOpts(
  siteKey: string, onToken: (t: string) => void,
): TurnstileOpts {
  return {
    sitekey: siteKey,
    callback: (token) => onToken(token),
    'expired-callback': () => onToken(''),
    'error-callback': () => onToken(''),
  };
}

function unmount(widgetIDRef: React.MutableRefObject<string | null>): void {
  const id = widgetIDRef.current;
  const api = window.turnstile;
  id && api && api.remove(id);
  widgetIDRef.current = null;
}

function ensureScript(): void {
  const already = document.querySelector(`script[src="${SCRIPT_URL}"]`);
  already || appendScript();
}

function appendScript(): void {
  const s = document.createElement('script');
  s.src = SCRIPT_URL;
  s.async = true;
  s.defer = true;
  document.head.appendChild(s);
}

async function waitForTurnstile(): Promise<void> {
  while (typeof window !== 'undefined' && !window.turnstile) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
