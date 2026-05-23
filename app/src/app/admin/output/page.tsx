import { AdminShell } from '@/components/admin/AdminShell';
import { OutputSection } from '@/components/admin/sections/OutputSection';

export default function AdminOutputPage() {
  return (
    <AdminShell active="output">
      <OutputSection />
    </AdminShell>
  );
}
