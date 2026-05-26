import { AdminShell } from '@/components/admin/AdminShell';
import { ApplicationsSection } from '@/components/admin/sections/ApplicationsSection';

export default function AdminApplicationsPage() {
  return (
    <AdminShell active="applications">
      <ApplicationsSection />
    </AdminShell>
  );
}
