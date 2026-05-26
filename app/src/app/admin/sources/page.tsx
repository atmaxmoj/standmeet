import { AdminShell } from '@/components/admin/AdminShell';
import { SourcesSection } from '@/components/admin/sections/SourcesSection';

export default function AdminSourcesPage() {
  return (
    <AdminShell active="sources">
      <SourcesSection />
    </AdminShell>
  );
}
