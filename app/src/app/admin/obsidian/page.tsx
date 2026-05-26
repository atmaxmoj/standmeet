import { AdminShell } from '@/components/admin/AdminShell';
import { StubSection } from '@/components/admin/sections/StubSection';

export default function AdminObsidianPage() {
  return (
    <AdminShell active="obsidian">
      <StubSection
        kicker="integrations · vault"
        title="obsidian"
        intent="Import an Obsidian vault into the corpus; export the corpus back to a vault. Two buttons, no live sync, no file watcher."
        mcpHint="`obsidian.import` / `obsidian.export` from Claude — keep frontmatter as canonical schema."
      />
    </AdminShell>
  );
}
