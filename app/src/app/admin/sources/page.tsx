import { AdminShell } from '@/components/admin/AdminShell';
import { StubSection } from '@/components/admin/sections/StubSection';

export default function AdminSourcesPage() {
  return (
    <AdminShell active="sources">
      <StubSection
        kicker="jobs · sources"
        title="job sources"
        intent="Register Greenhouse / Lever / Ashby / RemoteOK / WWR / HN / SmartRecruiters / Workable feeds. Each source has its own filter DSL + cadence."
        mcpHint="`jobs.register_source` / `jobs.list_sources` from Claude."
      />
    </AdminShell>
  );
}
