// use-code-modals —— Codes section 的 modal switchboard。
// 一次只一个开着 —— creating / qrCode / previewCode 互斥。

import { useCallback, useState } from 'react';

import type { CodeView } from '@/lib/admin/use-codes';

export interface CodeModalsState {
  creating: boolean;
  qrCode: CodeView | null;
  previewCode: CodeView | null;
  openCreate: (existing?: CodeView) => void;
  openQR: (c: CodeView) => void;
  openPreview: (c: CodeView) => void;
  closeAll: () => void;
}

export function useCodeModalState(): CodeModalsState {
  const [creating, setCreating] = useState(false);
  const [qrCode, setQrCode] = useState<CodeView | null>(null);
  const [previewCode, setPreviewCode] = useState<CodeView | null>(null);

  const openCreate = useCallback((_existing?: CodeView) => {
    setQrCode(null); setPreviewCode(null); setCreating(true);
  }, []);
  const openQR = useCallback((c: CodeView) => {
    setCreating(false); setPreviewCode(null); setQrCode(c);
  }, []);
  const openPreview = useCallback((c: CodeView) => {
    setCreating(false); setQrCode(null); setPreviewCode(c);
  }, []);
  const closeAll = useCallback(() => {
    setCreating(false); setQrCode(null); setPreviewCode(null);
  }, []);

  return { creating, qrCode, previewCode, openCreate, openQR, openPreview, closeAll };
}
