// /admin/edit/<slug> — the custom-page editor route. The list at /admin/custom-pages links here;
// this is where the mini-IDE (files + CodeMirror + widgets + preview) lives. slug === 'new' starts
// a fresh page (editable slug, create-on-save).

import { PageEditor } from '@/components/admin/sections/custom-pages/PageEditor';

export default async function EditCustomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PageEditor slug={slug} />;
}
