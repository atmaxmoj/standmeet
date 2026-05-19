import { AdminShell } from '@/components/admin/AdminShell';
import { WikiSection } from '@/components/admin/sections/WikiSection';

export default function AdminWikiPage() {
  return (
    <AdminShell active="wiki">
      <WikiSection />
    </AdminShell>
  );
}
