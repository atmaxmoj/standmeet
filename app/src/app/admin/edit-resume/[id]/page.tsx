// edit-resume/[id] —— the Puck-based résumé editor route (Q0). Edits a draft with Puck
// (resume-puck-config's fixed section components); Puck owns the state and the owner's Save persists
// puck_data + the derived resume_content (the typst render + committed PDF source). No autosave —
// state lives in Puck until Save (owner: "点 save 就 save"). The legacy ResumeComposer still exists;
// cutting over to this (and retiring the old composer's specs) is a separate step.
// docs/design/resume-composer-puck.md.

'use client';

import { useParams } from 'next/navigation';

import { PuckResumeEditor } from '@/components/admin/composer/PuckResumeEditor';
import { Skel } from '@/components/skeletons/Skel';
import { useDraftDetail } from '@/lib/admin/draft-detail';
import type { DraftModel } from '@/lib/admin/draft-model';

export default function EditResumePage() {
  const params = useParams();
  const id = typeof params?.['id'] === 'string' ? params['id'] : '';
  const { model, puckData, error } = useDraftDetail(id);
  return <EditResumeBody model={model} puckData={puckData} error={error} />;
}

function EditResumeBody({ model, puckData, error }: {
  model: DraftModel | null; puckData: unknown; error: string | null;
}) {
  const failed = error !== null;
  return failed
    ? <p data-testid="edit-resume-error" className="p-6 text-(--color-accent)">{error}</p>
    : model === null
      ? <div data-testid="edit-resume-loading" className="p-6"><Skel h="h-8" w="w-64" /></div>
      : <PuckResumeEditor model={model} initialPuckData={puckData} />;
}
