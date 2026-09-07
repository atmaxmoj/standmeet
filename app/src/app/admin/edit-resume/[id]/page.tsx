// edit-resume/[id] —— the Puck-based résumé editor route (Q0). A new surface that edits a draft with
// Puck (resume-puck-config's fixed section components) and autosaves the derived resume_content, which
// the typst render + committed PDF use. The legacy ResumeComposer still exists; cutting over to this
// (and retiring the old composer's specs) is a separate step. docs/design/resume-composer-puck.md.

'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';

import { PuckResumeEditor } from '@/components/admin/composer/PuckResumeEditor';
import { Skel } from '@/components/skeletons/Skel';
import { useDraftDetail } from '@/lib/admin/draft-detail';
import { useDraftAutosave } from '@/lib/admin/use-draft-autosave';
import type { DraftModel } from '@/lib/admin/draft-model';

export default function EditResumePage() {
  const params = useParams();
  const id = typeof params?.['id'] === 'string' ? params['id'] : '';
  const { model, error } = useDraftDetail(id);
  return <EditResumeBody model={model} error={error} />;
}

function EditResumeBody({ model, error }: { model: DraftModel | null; error: string | null }) {
  const failed = error !== null;
  return failed
    ? <p data-testid="edit-resume-error" className="p-6 text-(--color-accent)">{error}</p>
    : model === null
      ? <div data-testid="edit-resume-loading" className="p-6"><Skel h="h-8" w="w-64" /></div>
      : <EditResumeLoaded initial={model} />;
}

// EditResumeLoaded —— the model is present, so useDraftAutosave can be called unconditionally here.
function EditResumeLoaded({ initial }: { initial: DraftModel }) {
  const [model, setModel] = useState<DraftModel>(initial);
  useDraftAutosave(model);
  return <PuckResumeEditor model={model} onChange={setModel} />;
}
