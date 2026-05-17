import { AdminShell } from '@/components/admin/AdminShell';
import { PageEditor } from '@/components/admin/PageEditor';

export default function AdminPageEditPage() {
  return <AdminShell active="page"><PageEditor /></AdminShell>;
}
