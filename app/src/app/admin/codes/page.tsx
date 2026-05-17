import { AdminShell } from '@/components/admin/AdminShell';
import { CodeList } from '@/components/admin/CodeList';

export default function AdminCodesPage() {
  return <AdminShell active="codes"><CodeList /></AdminShell>;
}
