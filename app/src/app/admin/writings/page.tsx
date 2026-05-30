import { AdminShell } from '@/components/admin/AdminShell';
import { WritingsSection } from '@/components/admin/sections/WritingsSection';

export default function AdminWritingsPage() {
  return <AdminShell active="writings"><WritingsSection /></AdminShell>;
}
