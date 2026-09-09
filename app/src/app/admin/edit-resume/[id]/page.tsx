// edit-resume/[id] —— the Puck-based résumé editor route (Q0). Edits a draft with Puck
// (resume-puck-config's fixed section components); Puck owns the state and the owner's Save persists
// the derived resume_content (the single canonical source — the Puck doc is re-derived from it on
// open, no separate puck_data copy). No autosave — state lives in Puck until Save (owner: "点 save
// 就 save"). docs/design/resume-composer-puck.md.

'use client';

import { useParams } from 'next/navigation';

import { PuckComposer } from '@/components/admin/composer/PuckComposer';
import { Skel } from '@/components/skeletons/Skel';
import { useDraftDetail } from '@/lib/admin/draft-detail';
import type { DraftModel } from '@/lib/admin/draft-model';

export default function EditResumePage() {
  const params = useParams();
  const id = typeof params?.['id'] === 'string' ? params['id'] : '';
  const { model, error } = useDraftDetail(id);
  return <EditResumeBody model={model} error={error} />;
}

function EditResumeBody({ model, error }: {
  model: DraftModel | null; error: string | null;
}) {
  const failed = error !== null;
  return failed
    ? <p data-testid="edit-resume-error" className="p-6 text-(--color-accent)">{error}</p>
    : model === null
      ? <div data-testid="edit-resume-loading" className="p-6"><Skel h="h-8" w="w-64" /></div>
      : <PuckComposer model={model} />;
}
