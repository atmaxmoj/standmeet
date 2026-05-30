import { AdminShell } from '@/components/admin/AdminShell';
import { RolesSection } from '@/components/admin/sections/RolesSection';

export default function AdminRolesPage() {
  return <AdminShell active="roles"><RolesSection /></AdminShell>;
}
