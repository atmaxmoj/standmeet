// /confirm-email — lands here when the owner opens the link in the confirmation email.
//
// **Public page**: the owner may open this email on another device, not logged in.
// Requiring login before confirming would force him to log in with the identity he
// hasn't switched to yet — and he's often changing email precisely because the old
// address is about to stop working.
//
// WARNING: `<Suspense>` is not decorative: the panel reads `useSearchParams()` (the
// token lives in the query string), and Next's static prerender can't see the query.
// Without the boundary, the build fails outright.

import { Suspense } from 'react';

import { AuthShell } from '@/components/auth/AuthShell';
import { ConfirmEmailPanel } from '@/components/auth/ConfirmEmailPanel';

export default function ConfirmEmailPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <ConfirmEmailPanel />
      </Suspense>
    </AuthShell>
  );
}
