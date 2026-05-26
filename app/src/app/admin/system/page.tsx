import { AdminShell } from '@/components/admin/AdminShell';
import { StubSection } from '@/components/admin/sections/StubSection';

export default function AdminSystemPage() {
  return (
    <AdminShell active="system">
      <StubSection
        kicker="settings · system"
        title="system"
        intent="Instance health (DB / Redis / MinIO latency), container versions, last sweeper run, plaintext backup export. Read-only; restart-style ops via docker compose on the host."
        mcpHint="not exposed to MCP — system surface 走 admin only。"
      />
    </AdminShell>
  );
}
