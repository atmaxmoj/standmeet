import { AdminShell } from '@/components/admin/AdminShell';
import { PlaceholderSection } from '@/components/admin/PlaceholderSection';

export default function AdminConnectorsPage() {
  return (
    <AdminShell active="connectors">
      <PlaceholderSection
        title="connectors"
        subtitle="external sources (Gmail / Calendar / …)"
        note="Connector tiles land later when OAuth flows are wired."
      />
    </AdminShell>
  );
}
