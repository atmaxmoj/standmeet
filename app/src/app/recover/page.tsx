// /recover — #100 account recovery. Owner uses the recovery phrase to sign back in when locked out.

import { AuthShell } from '@/components/auth/AuthShell';
import { RecoverForm } from '@/components/auth/RecoverForm';

export default function RecoverPage() {
  return (
    <AuthShell>
      <RecoverForm />
    </AuthShell>
  );
}
