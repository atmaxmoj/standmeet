import { AdminShell } from '@/components/admin/AdminShell';
import { PlaceholderSection } from '@/components/admin/PlaceholderSection';

export default function AdminConversationsPage() {
  return (
    <AdminShell active="conversations">
      <PlaceholderSection
        title="conversations"
        subtitle="visitor chat sessions"
        note="Conversation review lands when backend listing endpoint exists."
      />
    </AdminShell>
  );
}
