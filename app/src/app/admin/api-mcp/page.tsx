import { AdminShell } from '@/components/admin/AdminShell';
import { APITokens } from '@/components/admin/APITokens';

export default function AdminAPIMCPPage() {
  return <AdminShell active="api-mcp"><APITokens /></AdminShell>;
}
