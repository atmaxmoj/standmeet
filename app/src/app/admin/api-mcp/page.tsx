import { AdminShell } from '@/components/admin/AdminShell';
import { PlaceholderSection } from '@/components/admin/PlaceholderSection';

export default function AdminAPIMCPPage() {
  return (
    <AdminShell active="api-mcp">
      <PlaceholderSection
        title="api · mcp"
        subtitle="API tokens + MCP endpoint URL"
        note="Token CRUD UI lands in M8 follow-up (api-only flow exists)."
      />
    </AdminShell>
  );
}
