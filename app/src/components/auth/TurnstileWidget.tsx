// TurnstileWidget — renders a host div for lib/auth/use-turnstile-mount to
// hook the Cloudflare Turnstile widget into. All imperative API calls go
// through the hook; this component is pure presentation.
//
// For an owner self-hosting from mainland China, the Turnstile script may be
// slow or unreachable; that deployment should leave TURNSTILE_SITE_KEY unset
// on the backend (feature off), so LoginForm doesn't render this component.

'use client';

import { useTurnstileMount } from '@/lib/auth/use-turnstile-mount';

type Props = { siteKey: string; onToken: (token: string) => void };

export function TurnstileWidget({ siteKey, onToken }: Props) {
  const hostRef = useTurnstileMount(siteKey, onToken);
  return <div ref={hostRef} data-testid="turnstile-host" className="my-2" />;
}
