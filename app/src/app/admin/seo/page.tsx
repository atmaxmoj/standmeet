import { AdminShell } from '@/components/admin/AdminShell';
import { SeoSection } from '@/components/admin/sections/SeoSection';

export default function AdminSEOPage() {
  return (
    <AdminShell active="seo">
      <SeoSection />
    </AdminShell>
  );
}
