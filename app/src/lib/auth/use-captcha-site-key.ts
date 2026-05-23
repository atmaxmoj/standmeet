// use-captcha-site-key —— /login 启动时拉一次 /api/v1/instance，从里面挑
// captcha_site_key。非空表示 backend 装了 Turnstile，要渲 widget。
//
// 整个 hook 故意不缓存到 zustand：/login 是 SSR + 客户端独立挂载的 leaf
// 页面，没有跨页共用必要；额外的 store 是过度抽象。

'use client';

import { useEffect, useState } from 'react';

type State = { ready: boolean; siteKey: string };

const INITIAL: State = { ready: false, siteKey: '' };

export function useCaptchaSiteKey(): State {
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    let alive = true;
    void fetch('/api/v1/instance', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { captcha_site_key: '' })
      .then((data: { captcha_site_key?: string }) => {
        if (!alive) return;
        setState({ ready: true, siteKey: data.captcha_site_key ?? '' });
      })
      .catch(() => { alive && setState({ ready: true, siteKey: '' }); });
    return () => { alive = false; };
  }, []);

  return state;
}
