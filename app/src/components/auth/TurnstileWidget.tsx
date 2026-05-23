// TurnstileWidget —— 渲一个 host div，让 lib/auth/use-turnstile-mount 钩
// Cloudflare Turnstile widget。所有 imperative API 走 hook，本组件只是
// presentation。
//
// 国内 owner 自托管时 Turnstile script 可能慢/挂；那种部署应该在后端不设
// TURNSTILE_SITE_KEY（feature off），LoginForm 也就不渲染本组件。

'use client';

import { useTurnstileMount } from '@/lib/auth/use-turnstile-mount';

type Props = { siteKey: string; onToken: (token: string) => void };

export function TurnstileWidget({ siteKey, onToken }: Props) {
  const hostRef = useTurnstileMount(siteKey, onToken);
  return <div ref={hostRef} data-testid="turnstile-host" className="my-2" />;
}
