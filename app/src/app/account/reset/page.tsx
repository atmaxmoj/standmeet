import { Suspense } from 'react';

import { AuthShell } from '@/components/auth/AuthShell';
import { PasswordResetForm } from '@/components/auth/PasswordResetForm';

// /account/reset?t=... — the server ran the `standmeet password-reset`
// subcommand; owner opens this URL to change the password. Token comes
// from the query string; the form POSTs to /api/v1/account/reset-password.
//
// PasswordResetForm calls useSearchParams() internally — Next 15 requires
// such components to mount inside <Suspense>, or static prerender breaks.
export default function PasswordResetPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <PasswordResetForm />
      </Suspense>
    </AuthShell>
  );
}
