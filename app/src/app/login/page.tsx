// /login — owner sign-in entry. On success redirects to /<handle> (switch to
// /admin once admin lands).

import { AuthShell } from '@/components/auth/AuthShell';
import { LoginForm } from '@/components/auth/LoginForm';

export default function LoginPage() {
  return (
    <AuthShell showOffers={false}>
      <LoginForm />
    </AuthShell>
  );
}
