import { AdminShell } from '@/components/admin/AdminShell';
import { CodesSection } from '@/components/admin/sections/CodesSection';

export default function AdminCodesPage() {
  return <AdminShell active="codes"><CodesSection /></AdminShell>;
}
