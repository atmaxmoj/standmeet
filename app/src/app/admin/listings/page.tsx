import { AdminShell } from '@/components/admin/AdminShell';
import { StubSection } from '@/components/admin/sections/StubSection';

export default function AdminListingsPage() {
  return (
    <AdminShell active="listings">
      <StubSection
        kicker="jobs · listings"
        title="listings (1d TTL)"
        intent="Today's fetched jobs from registered sources. Shortlist → tells Claude which to draft a resume for. Pool TTL 1 day; missed it, fetch again."
        mcpHint="`jobs.fetch_new` / `jobs.show` / `jobs.discard` from Claude."
      />
    </AdminShell>
  );
}
