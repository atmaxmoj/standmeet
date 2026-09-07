// use-composer-code —— the composer's access-code selection. The résumé's QR always carries a REAL
// existing code (public or invited); this never mints one. Returns the active codes to pick from,
// the current selection (defaulted to the first existing code), and the QR URL the preview renders.
//
// Lives in lib, not the component: the presentation layer caps complexity at 3, and the default +
// derivations would blow that in the component.

'use client';

import { useEffect, useState } from 'react';

import { useCodes, type CodeView } from '@/lib/admin/use-codes';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { resumeQRURL } from '@/lib/admin/save-draft';

export interface ComposerCode {
  activeCodes: readonly CodeView[];
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

function activeOf(codes: readonly CodeView[]): readonly CodeView[] {
  return codes.filter((c) => c.status === 'active');
}

function defaultCodeId(cur: string, active: readonly CodeView[]): string {
  return cur === '' && active.length > 0 ? active[0]?.id ?? '' : cur;
}

export function useComposerCode(): ComposerCode {
  const session = useAdminSession();
  const { codes } = useCodes();
  const active = activeOf(codes);
  const [codeId, setCodeId] = useState('');
  useEffect(() => { setCodeId((cur) => defaultCodeId(cur, activeOf(codes))); }, [codes]);
  const selectedCode = active.find((c) => c.id === codeId);
  const selectedCodePlaintext = selectedCode ? selectedCode.code : '';
  const qrURL = resumeQRURL(publicURLOf(session), selectedCodePlaintext);
  return { activeCodes: active, codeId, setCodeId, selectedCode, selectedCodePlaintext, qrURL };
}
