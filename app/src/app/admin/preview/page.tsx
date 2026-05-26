import { AdminShell } from '@/components/admin/AdminShell';
import { StubSection } from '@/components/admin/sections/StubSection';

export default function AdminPreviewPage() {
  return (
    <AdminShell active="preview">
      <StubSection
        kicker="access · external view"
        title="preview"
        intent="See your public page the way an access-coded visitor or a BYOAI visitor would. Toggle tier, swap codes, sanity-check the gate."
        mcpHint="No MCP write — this surface is read-only."
      />
    </AdminShell>
  );
}
