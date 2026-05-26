import { AdminShell } from '@/components/admin/AdminShell';
import { ObsidianSection } from '@/components/admin/sections/ObsidianSection';

export default function AdminObsidianPage() {
  return (
    <AdminShell active="obsidian">
      <ObsidianSection />
    </AdminShell>
  );
}
