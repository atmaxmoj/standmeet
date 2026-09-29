// use-composer-code —— the composer's access-code selection. The résumé's QR always carries a REAL
// existing code (public or invited); this never mints one. Offers the newest active codes (a
// server-side search narrows them), the current selection (defaulted to the newest code), and the
// QR URL the preview renders.
//
// The selection is held as the code itself, not an id looked up in the offered page: a search that
// no longer shows the picked code must not un-pick it.
//
// Lives in lib, not the component: the presentation layer caps complexity at 3, and the default +
// derivations would blow that in the component.

'use client';

import { useEffect, useState } from 'react';

import { useCodePicker, type CodePicker, type CodeView } from '@/lib/admin/use-codes';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { resumeQRURL } from '@/lib/admin/save-draft';

export interface ComposerCode {
  activeCodes: readonly CodeView[];
  picker: CodePicker;
  codeId: string;
  setCodeId: (id: string) => void;
  selectedCode: CodeView | undefined;
  // selectedCodePlaintext —— the picked code's plaintext ('' when none). Derived here so the composer
  // reads a pre-computed value (the presentation layer does no derivation in render).
  selectedCodePlaintext: string;
  qrURL: string;
}

function publicURLOf(session: ReturnType<typeof useAdminSession>): string {
  return session.kind === 'ready' ? session.session.public_url : '';
}

export function useComposerCode(): ComposerCode {
  const session = useAdminSession();
  // application: 'none' —— one code backs one application, so a code an earlier application holds
  // cannot carry this résumé's QR; offering it made the second SEND fail.
  const picker = useCodePicker({ application: 'none' });
  const offered = picker.page.items;
  const [selectedCode, setSelected] = useState<CodeView | undefined>(undefined);
  useEffect(() => { setSelected((cur) => cur ?? offered[0]); }, [offered]);
  const setCodeId = (id: string) => setSelected(offered.find((c) => c.id === id) ?? selectedCode);
  const selectedCodePlaintext = selectedCode ? selectedCode.code : '';
  const qrURL = resumeQRURL(publicURLOf(session), selectedCodePlaintext);
  return {
    activeCodes: withSelected(offered, selectedCode), picker, codeId: selectedCode?.id ?? '',
    setCodeId, selectedCode, selectedCodePlaintext, qrURL,
  };
}

// withSelected —— the offered codes, plus the picked one when the current search hides it, so the
// select still shows what is picked.
function withSelected(offered: readonly CodeView[], picked: CodeView | undefined): readonly CodeView[] {
  return picked && !offered.some((c) => c.id === picked.id) ? [picked, ...offered] : offered;
}
