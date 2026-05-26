import { AdminShell } from '@/components/admin/AdminShell';
import { SystemSection } from '@/components/admin/sections/SystemSection';

export default function AdminSystemPage() {
  return (
    <AdminShell active="system">
      <SystemSection />
    </AdminShell>
  );
}
