import { AdminShell } from '@/components/admin/AdminShell';
import { PreviewSection } from '@/components/admin/sections/PreviewSection';

export default function AdminPreviewPage() {
  return (
    <AdminShell active="preview">
      <PreviewSection />
    </AdminShell>
  );
}
