// use-code-modals —— modal switchboard for the Codes section.
// Only one is open at a time — creating / qrCode / previewCode are mutually exclusive.

import { useCallback, useState } from 'react';

import type { CodeView } from '@/lib/admin/use-codes';

export interface CodeModalsState {
  creating: boolean;
  editing: CodeView | null;
  qrCode: CodeView | null;
  previewCode: CodeView | null;
  openCreate: (existing?: CodeView) => void;
  openQR: (c: CodeView) => void;
  openPreview: (c: CodeView) => void;
  closeAll: () => void;
}

export function useCodeModalState(): CodeModalsState {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CodeView | null>(null);
  const [qrCode, setQrCode] = useState<CodeView | null>(null);
  const [previewCode, setPreviewCode] = useState<CodeView | null>(null);

  const openCreate = useCallback((existing?: CodeView) => {
    setQrCode(null); setPreviewCode(null);
    setEditing(existing ?? null);
    setCreating(true);
  }, []);
  const openQR = useCallback((c: CodeView) => {
    setCreating(false); setEditing(null); setPreviewCode(null); setQrCode(c);
  }, []);
  const openPreview = useCallback((c: CodeView) => {
    setCreating(false); setEditing(null); setQrCode(null); setPreviewCode(c);
  }, []);
  const closeAll = useCallback(() => {
    setCreating(false); setEditing(null); setQrCode(null); setPreviewCode(null);
  }, []);

  return {
    creating, editing, qrCode, previewCode,
    openCreate, openQR, openPreview, closeAll,
  };
}
