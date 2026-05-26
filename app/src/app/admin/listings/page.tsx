import { AdminShell } from '@/components/admin/AdminShell';
import { ListingsSection } from '@/components/admin/sections/ListingsSection';

export default function AdminListingsPage() {
  return (
    <AdminShell active="listings">
      <ListingsSection />
    </AdminShell>
  );
}
