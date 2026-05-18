import { AdminShell } from '@/components/admin/AdminShell';
import { PlaceholderSection } from '@/components/admin/PlaceholderSection';

export default function AdminWikiPage() {
  return (
    <AdminShell active="wiki">
      <PlaceholderSection
        title="wiki"
        subtitle="curated entries promoted from raw"
        note="Wiki list + edit lands later."
      />
    </AdminShell>
  );
}
