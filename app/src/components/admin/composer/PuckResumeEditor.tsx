// PuckResumeEditor —— the Puck canvas for the résumé editor (the fixed section components in
// resume-puck-config). Puck owns the editor state; every edit is forwarded to the parent via onData
// (tracked, not persisted). The parent composer owns Save/SEND/preview/code and the commit-to-storage
// moment — no autosave (owner: "puck 自己的 redux,点 save 就 save"). docs/design/resume-composer-puck.md.
//
// Load: a draft with saved puck_data opens from it; a draft without (agent-created / pre-Puck)
// derives the initial doc from resume_content via toPuckData — old rows just open.

'use client';

import { useState, useCallback } from 'react';
import { Puck, type Data } from '@measured/puck';
import '@measured/puck/puck.css';

import { resumePuckConfig } from '@/lib/admin/resume-puck-config';
import { toPuckData, fromPuckData, type PuckData } from '@/lib/admin/resume-puck';
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

// puckInitialData —— the document Puck opens with: the saved puck_data verbatim, else derived from
// resume_content so old rows just open.
export function puckInitialData(model: DraftModel, savedPuckData: unknown): Data {
  return savedPuckData == null
    ? asPuckData(toPuckData(draftToResumeContent(model)))
    : savedAsData(savedPuckData);
}

// deriveModel —— fold the current Puck document back into the DraftModel (base carries the id + job
// context; the Puck doc carries the edited sections + arrangement). The canonical resume_content the
// typst render + commit use comes from this.
export function deriveModel(base: DraftModel, data: Data): DraftModel {
  return applyResumeContentToDraft(base, fromPuckData(fromData(data)));
}

export function PuckResumeEditor({ initial, onData }: {
  initial: Data;
  onData: (data: Data) => void;
}) {
  // Puck owns the state after this first render; onChange forwards each edit to the parent, which
  // tracks the latest doc for Save/SEND. Nothing persists here.
  const onChange = useCallback((data: Data) => onData(data), [onData]);
  const [data] = useState<Data>(initial);
  return (
    <div data-testid="puck-resume-editor" className="h-full">
      <Puck config={resumePuckConfig} data={data} onChange={onChange} />
    </div>
  );
}
