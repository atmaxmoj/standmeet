import { AdminShell } from '@/components/admin/AdminShell';
import { DashboardSection } from '@/components/admin/sections/DashboardSection';

export default function AdminDashboardPage() {
  return (
    <AdminShell active="dashboard">
      <DashboardSection />
    </AdminShell>
  );
}
