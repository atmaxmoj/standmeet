// use-turnstile-mount —— Cloudflare Turnstile widget 的挂载/销毁副作用。
//
// 抽出来当 lib hook 是因为 presentation 层（TurnstileWidget）不允许出现
// imperative branch（`if`）。所有 imperative widget API 调用集中在这里：
//   1. 把 turnstile script tag 插一次到 document.head；
//   2. poll window.turnstile 直到就绪；
//   3. 调 turnstile.render，token callback 转发给 onToken；
//   4. unmount 时 turnstile.remove 清掉 widget。

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

// renderWidget —— 渲一次，并且**说出结果**。没有这一句时，一个渲不出来的校验框在页面上
// 就是一段空白：访客看见「过一次校验就放你过去」却没有可点的东西，而控制台一片安静 ——
// 于是只能靠猜。widget id 是产品这一侧唯一拿得到的回执，拿到就报，拿不到也报。
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
