import { AdminShell } from '@/components/admin/AdminShell';
import { ConnectorsSection } from '@/components/admin/sections/ConnectorsSection';

export default function AdminConnectorsPage() {
  return (
    <AdminShell active="connectors">
      <ConnectorsSection />
    </AdminShell>
  );
}
