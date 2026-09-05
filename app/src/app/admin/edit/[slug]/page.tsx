// /admin/edit/<slug> — the microsite editor route. The list at /admin/microsites links here;
// this is where the mini-IDE (files + CodeMirror + widgets + preview) lives. slug === 'new' starts
// a fresh page (editable slug, create-on-save).

import { PageEditor } from '@/components/admin/sections/microsites/PageEditor';

export default async function EditMicrosite({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PageEditor slug={slug} />;
}
