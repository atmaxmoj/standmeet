// PuckResumeEditor —— the résumé editor built on Puck (the fixed section components in
// resume-puck-config). Puck owns the editor state; on every edit it syncs OUT to the DraftModel
// (via fromPuckData → applyResumeContentToDraft) so autosave + the typst preview see the change.
// The initial document is derived once from the model; Puck is the source of truth after that.
// docs/design/resume-composer-puck.md (Q0). This is the new editor surface; the cutover from the
// legacy composer is a separate step.

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

export function PuckResumeEditor({ model, onChange }: {
  model: DraftModel;
  onChange: (m: DraftModel) => void;
}) {
  // Derived ONCE, in a lazy useState initializer (no useMemo in the presentation layer): Puck then
  // owns the state (owner: "puck 自己的 redux"). Re-deriving each render would reset the editor.
  const [initial] = useState<Data>(() => asPuckData(toPuckData(draftToResumeContent(model))));
  const handleChange = useCallback((data: Data) => {
    onChange(applyResumeContentToDraft(model, fromPuckData(fromData(data))));
  }, [model, onChange]);
  return (
    <div data-testid="puck-resume-editor">
      <Puck config={resumePuckConfig} data={initial} onChange={handleChange} />
    </div>
  );
}
