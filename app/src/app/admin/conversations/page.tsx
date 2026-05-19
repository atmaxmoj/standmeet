import { AdminShell } from '@/components/admin/AdminShell';
import { ConversationsSection } from '@/components/admin/sections/ConversationsSection';

export default function AdminConversationsPage() {
  return (
    <AdminShell active="conversations">
      <ConversationsSection />
    </AdminShell>
  );
}
