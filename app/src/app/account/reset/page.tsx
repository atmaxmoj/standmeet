import { Suspense } from 'react';

import { AuthShell } from '@/components/auth/AuthShell';
import { PasswordResetForm } from '@/components/auth/PasswordResetForm';

// /account/reset?t=... —— 服务器上跑了 `standmeet password-reset` 子命令的
// owner 拿这条 URL 进来改密码。token 从 query 拿；form 调 POST
// /api/v1/account/reset-password。
//
// PasswordResetForm 内部 useSearchParams()——Next 15 要求这种组件在
// <Suspense> 里挂，否则静态预渲会炸。
export default function PasswordResetPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <PasswordResetForm />
      </Suspense>
    </AuthShell>
  );
}
