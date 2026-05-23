import { AdminShell } from '@/components/admin/AdminShell';
import { AccountSection } from '@/components/admin/sections/AccountSection';

export default function AdminAccountPage() {
  return (
    <AdminShell active="account">
      <AccountSection />
    </AdminShell>
  );
}
