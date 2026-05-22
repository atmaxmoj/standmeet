import { AdminShell } from '@/components/admin/AdminShell';
import { CustomPagesSection } from '@/components/admin/sections/CustomPagesSection';

export default function AdminCustomPagesPage() {
  return (
    <AdminShell active="custom-pages">
      <CustomPagesSection />
    </AdminShell>
  );
}
