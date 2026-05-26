import { AdminShell } from '@/components/admin/AdminShell';
import { DraftsSection } from '@/components/admin/sections/DraftsSection';

export default function AdminDraftsPage() {
  return (
    <AdminShell active="drafts">
      <DraftsSection />
    </AdminShell>
  );
}
