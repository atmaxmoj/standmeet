// PuckResumeEditor —— the résumé editor built on Puck (the fixed section components in
// resume-puck-config). Puck owns the editor state; it lives in Puck until the owner clicks Save —
// no autosave churn (owner: "puck 自己的 redux,点 save 就 save"). Save persists the Puck state
// (puck_data) verbatim AND the derived resume_content (the typst render source), so reopening
// restores the exact arrangement and the committed PDF matches. An un-Saved edit does NOT persist.
// docs/design/resume-composer-puck.md (Q0).
//
// Load: a draft with saved puck_data opens from it; a draft without (agent-created / pre-Puck)
// derives the initial doc from resume_content via toPuckData — old rows just open.

'use client';

import { useState, useRef, useCallback } from 'react';
import { Puck, type Data } from '@measured/puck';
import { useTranslations } from 'next-intl';
import '@measured/puck/puck.css';

import { resumePuckConfig } from '@/lib/admin/resume-puck-config';
import { toPuckData, fromPuckData, type PuckData } from '@/lib/admin/resume-puck';
import { savePuckDraft } from '@/lib/admin/save-draft';
import {
  draftToResumeContent, applyResumeContentToDraft, type DraftModel,
} from '@/lib/admin/draft-model';

// Puck's Data type is component-typed; our PuckData is the structural projection. They match at
// runtime — cast at this one boundary (the pure projection stays Puck-runtime-free + unit-tested).
function asPuckData(pd: PuckData): Data {
  return pd as unknown as Data; // eslint-disable-line @typescript-eslint/consistent-type-assertions
}
function fromData(d: Data): PuckData {
  return d as unknown as PuckData; // eslint-disable-line @typescript-eslint/consistent-type-assertions
}
// A draft's saved puck_data arrives as `unknown` (the app never inspects it); it was written by Puck
// itself, so at this one boundary it is a Puck Data document.
function savedAsData(u: unknown): Data {
  return u as Data; // eslint-disable-line @typescript-eslint/consistent-type-assertions
}

function initialData(model: DraftModel, savedPuckData: unknown): Data {
  return savedPuckData == null
    ? asPuckData(toPuckData(draftToResumeContent(model)))
    : savedAsData(savedPuckData);
}

export function PuckResumeEditor({ model, initialPuckData }: {
  model: DraftModel;
  // The draft's saved Puck state, or null when it has none yet (derive from resume_content).
  initialPuckData: unknown;
}) {
  const t = useTranslations('adminShell.composer');
  // Derived ONCE, in a lazy useState initializer (no useMemo in the presentation layer): Puck then
  // owns the state. A saved puck_data opens verbatim; otherwise derive it from resume_content.
  const [initial] = useState<Data>(() => initialData(model, initialPuckData));
  // The latest Puck doc, tracked (not persisted) on every edit; Save reads it. Editing updates this
  // ref only — nothing persists until Save, so an un-Saved edit is lost on reopen (D4).
  const latest = useRef<Data>(initial);
  const onChange = useCallback((data: Data) => { latest.current = data; }, []);

  const handleSave = useCallback(() => {
    const data = latest.current;
    const derived = applyResumeContentToDraft(model, fromPuckData(fromData(data)));
    void savePuckDraft(derived, data);
  }, [model]);

  return (
    <div data-testid="puck-resume-editor">
      <div className="flex items-center justify-end gap-3 px-4 py-2 border-b border-(--color-rule)">
        <button
          type="button" onClick={handleSave}
          className="sm-btn sm-btn-solid sm-btn-sm" data-testid="puck-save"
        >
          {t('save')}
        </button>
      </div>
      <Puck config={resumePuckConfig} data={initial} onChange={onChange} />
    </div>
  );
}
