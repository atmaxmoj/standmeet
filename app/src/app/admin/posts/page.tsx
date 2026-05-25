import { AdminShell } from '@/components/admin/AdminShell';
import { PostsSection } from '@/components/admin/sections/PostsSection';

export default function AdminPostsPage() {
  return <AdminShell active="posts"><PostsSection /></AdminShell>;
}
