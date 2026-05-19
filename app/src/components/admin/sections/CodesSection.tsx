// CodesSection —— /admin/codes 的设计稿版本。
// SectionHeader + intro 文案 + 网格的 CodeCard。"+ new code" 打开 CodeCreateModal。
// modal save 调 useCodes.createCode；QR / Preview modal 也接进来。

'use client';

import { useCallback } from 'react';

import { Btn } from '../atoms/Btn';
import { SectionHeader } from '../SectionHeader';
import { CodeCard } from './codes/CodeCard';
import { CodeCreateModal } from '../modals/CodeCreateModal';
import { CodeQRModal } from '../modals/CodeQRModal';
import { VisitorPreviewModal } from '../modals/VisitorPreviewModal';
import { useCodeModalState } from '@/lib/admin/use-code-modals';
import { useCodes, type CodeView, type CodesHook } from '@/lib/admin/use-codes';

export function CodesSection() {
  const hook = useCodes();
  const modals = useCodeModalState();
  return (
    <>
      <SectionHeader
        kicker="surface · access"
        title="codes"
        count={titleCount(hook)}
        action={<NewCodeBtn open={modals.openCreate} />}
      />
      <Intro />
      <CodeListBody hook={hook} openCreate={modals.openCreate} openQR={modals.openQR} openPreview={modals.openPreview} />
      <CodeCreateModalSlot
        open={modals.creating}
        onClose={modals.closeAll}
        createCode={hook.createCode}
      />
      <ModalSlot code={modals.qrCode} kind="qr" onClose={modals.closeAll} />
      <ModalSlot code={modals.previewCode} kind="preview" onClose={modals.closeAll} />
    </>
  );
}

function NewCodeBtn({ open }: { open: () => void }) {
  return <Btn kind="primary" onClick={open} testid="code-new">＋ new code</Btn>;
}

function titleCount(hook: CodesHook): string {
  return hook.state.kind === 'ready' ? `${hook.state.codes.length} codes` : '';
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Each code gates a slice of your wiki for a known recipient — a hiring loop, an investor intro,
      or a single press call. Multiple people can share one code; when someone enters it, the AI asks
      who they are and assigns them to the code&apos;s member list. Each card carries a QR.
    </p>
  );
}

function CodeListBody({
  hook, openCreate, openQR, openPreview,
}: {
  hook: CodesHook;
  openCreate: (existing?: CodeView) => void;
  openQR: (c: CodeView) => void;
  openPreview: (c: CodeView) => void;
}) {
  return hook.state.kind === 'loading' ? <Loading />
    : hook.state.kind === 'error' ? <ErrorMsg message={hook.state.message} />
    : <CodeGrid codes={hook.state.codes} openEdit={openCreate} openQR={openQR} openPreview={openPreview} />;
}

function Loading() {
  return <p className="mono text-(--color-muted)">loading…</p>;
}

function ErrorMsg({ message }: { message: string }) {
  return <p className="mono text-(--color-accent)">{message}</p>;
}

function CodeGrid({
  codes, openEdit, openQR, openPreview,
}: {
  codes: readonly CodeView[];
  openEdit: (existing?: CodeView) => void;
  openQR: (c: CodeView) => void;
  openPreview: (c: CodeView) => void;
}) {
  return codes.length === 0
    ? <EmptyState />
    : (
      <ul className="grid grid-cols-1 xl:grid-cols-2 gap-5" data-testid="code-list">
        {codes.map((c) => (
          <li key={c.id} data-testid={`code-row-${c.code}`}>
            <CodeCard code={c} onEdit={openEdit} onPreview={openPreview} onShowQR={openQR} />
          </li>
        ))}
      </ul>
    );
}

function EmptyState() {
  return (
    <p className="reading italic text-(--color-muted)" data-testid="code-list">
      No codes yet.
    </p>
  );
}

function CodeCreateModalSlot({
  open, onClose, createCode,
}: {
  open: boolean;
  onClose: () => void;
  createCode: CodesHook['createCode'];
}) {
  const onSave = useCallback(async (input: Parameters<CodesHook['createCode']>[0]) => {
    await createCode(input);
    onClose();
  }, [createCode, onClose]);
  return open ? <CodeCreateModal onClose={onClose} onSave={onSave} /> : null;
}

function ModalSlot({
  code, kind, onClose,
}: { code: CodeView | null; kind: 'qr' | 'preview'; onClose: () => void }) {
  return code
    ? <ModalForKind code={code} kind={kind} onClose={onClose} />
    : null;
}

function ModalForKind({
  code, kind, onClose,
}: { code: CodeView; kind: 'qr' | 'preview'; onClose: () => void }) {
  return kind === 'qr'
    ? <CodeQRModal code={code} onClose={onClose} />
    : <VisitorPreviewModal code={code} onClose={onClose} />;
}

