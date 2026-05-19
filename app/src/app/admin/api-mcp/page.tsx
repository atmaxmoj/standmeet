import { AdminShell } from '@/components/admin/AdminShell';
import { ApiSection } from '@/components/admin/sections/ApiSection';

export default function AdminAPIMCPPage() {
  return <AdminShell active="api-mcp"><ApiSection /></AdminShell>;
}
