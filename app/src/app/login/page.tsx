// /login —— owner sign-in 入口。成功后跳到 /<handle>（admin 落地后改跳 /admin）。

import { AuthShell } from '@/components/auth/AuthShell';
import { LoginForm } from '@/components/auth/LoginForm';

export default function LoginPage() {
  return (
    <AuthShell>
      <LoginForm />
    </AuthShell>
  );
}
