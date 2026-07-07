// /recover —— #100 account recovery。owner 锁在外面时用 recovery phrase 登回来。

import { AuthShell } from '@/components/auth/AuthShell';
import { RecoverForm } from '@/components/auth/RecoverForm';

export default function RecoverPage() {
  return (
    <AuthShell>
      <RecoverForm />
    </AuthShell>
  );
}
