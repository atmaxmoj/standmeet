import { AdminShell } from '@/components/admin/AdminShell';
import { PlaceholderSection } from '@/components/admin/PlaceholderSection';

export default function AdminCodesPage() {
  return (
    <AdminShell active="codes">
      <PlaceholderSection
        title="codes"
        subtitle="access codes for invited visitors"
        note="Code CRUD UI lands in M8 follow-up (api-only flow exists)."
      />
    </AdminShell>
  );
}
