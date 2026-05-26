import { AdminShell } from '@/components/admin/AdminShell';
import { StubSection } from '@/components/admin/sections/StubSection';

export default function AdminDashboardPage() {
  return (
    <AdminShell active="dashboard">
      <StubSection
        kicker="overview"
        title="dashboard"
        intent="At-a-glance — last 14 days corpus growth, pending requests, active codes, top visitor queries. Pulls from raw + conversations + codes; no edits here, just routing."
        mcpHint="ask Claude `me` + `list_recent_raw` + `list_my_api_keys` for ad-hoc views."
      />
    </AdminShell>
  );
}
