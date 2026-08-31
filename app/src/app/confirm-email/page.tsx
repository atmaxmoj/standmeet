// /confirm-email —— 点开确认信里的链接就落在这里。
//
// **公开页**：owner 点开这封信的时候可能在另一台设备上、没登录。要求先登录才能确认，
// 等于要求他先用**还没换过去的那个身份**登进来 —— 而他改邮箱常常正是因为旧地址快用不了了。
//
// ⚠️ `<Suspense>` 不是装饰：面板读 `useSearchParams()`（token 在 query 里），
// 而 Next 静态预渲染时拿不到 query，没有边界就直接 build 失败。

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
