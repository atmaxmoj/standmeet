// admin layout —— #34:AdminShell 挂在 layout,Next app router 跨 section 导航
// 不 remount 这一层 → sidebar(SystemPulse + nav + 滚动位置)持久,不再每次点击
// reset 到顶。各 page 只渲自己的 Section,active 高亮由 AdminShell 从 pathname 派生。

import type { ReactNode } from 'react';

import { AdminShell } from '@/components/admin/AdminShell';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
