// composer-code-context —— carries the composer's access-code selection down into the Puck Header
// component's field panel. The QR is a Header element (owner: "码是在 header 里面的"), so the control
// that picks WHICH code the QR encodes lives with the Header's other fields, not in a separate top
// bar. The selection is composer state (it drives SEND + the QR preview), NOT résumé content, so it
// travels by context instead of a Puck prop — nothing about it is written into resume_content.
//
// The provider wraps <Puck> (PuckComposer); the consumer is the Header's custom `codePicker` field
// (resume-puck-config). The field render runs only in the editor panel, never in <Render>, so the
// print path is untouched. The default (empty codes / no-op setter) keeps <Render> and any provider-
// less mount from throwing.

'use client';

import { createContext, useContext } from 'react';

import type { CodeView } from '@/lib/admin/use-codes';

export interface ComposerCodeControl {
  activeCodes: readonly CodeView[];
  codeId: string;
  setCodeId: (id: string) => void;
}

const noopSetCodeId = (): void => undefined;

export const ComposerCodeContext = createContext<ComposerCodeControl>({
  activeCodes: [],
  codeId: '',
  setCodeId: noopSetCodeId,
});

export function useComposerCodeControl(): ComposerCodeControl {
  return useContext(ComposerCodeContext);
}
