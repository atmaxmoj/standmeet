// use-captcha-site-key —— fetches /api/v1/instance once when /login starts,
// and picks out captcha_site_key. Non-empty means the backend has Turnstile
// installed and the widget should render.
//
// This hook deliberately isn't cached in zustand: /login is an SSR + client
// independently-mounted leaf page with no cross-page sharing need; an extra
// store would be over-abstraction.

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
