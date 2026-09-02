// admin layout — #34: AdminShell mounts in the layout, so Next's app router keeps
// this level un-remounted across section navigation. The sidebar (SystemPulse +
// nav + scroll position) persists instead of resetting to top on every click.
// Each page renders only its own Section; active highlight is derived by
// AdminShell from the pathname.

import type { ReactNode } from 'react';

import { AdminShell } from '@/components/admin/AdminShell';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
