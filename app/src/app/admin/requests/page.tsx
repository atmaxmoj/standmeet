import { AdminShell } from '@/components/admin/AdminShell';
import { RequestsSection } from '@/components/admin/sections/RequestsSection';

export default function AdminRequestsPage() {
  return (
    <AdminShell active="requests">
      <RequestsSection />
    </AdminShell>
  );
}
