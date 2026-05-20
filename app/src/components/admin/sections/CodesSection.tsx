// CodesSection —— /admin/codes 的设计稿版本。
// SectionHeader + intro 文案 + 网格的 CodeCard。"+ new code" 打开 CodeCreateModal。
// modal save 调 useCodes.createCode；QR / Preview modal 也接进来。

'use client';

import { useCallback } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { CodeCard } from '@/components/admin/sections/codes/CodeCard';
import { CodeCreateModal } from '@/components/admin/modals/CodeCreateModal';
import { CodeQRModal } from '@/components/admin/modals/CodeQRModal';
import { VisitorPreviewModal } from '@/components/admin/modals/VisitorPreviewModal';
import { useCodeModalState } from '@/lib/admin/use-code-modals';
import { useCodes, type CodeView, type CodesHook } from '@/lib/admin/use-codes';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

function readyError(hook: CodesHook): string | null {
  return hook.state.kind === 'ready' ? hook.state.error : null;
}

export function CodesSection() {
  const hook = useCodes();
  const modals = useCodeModalState();
  const toast = useToast();
  useEffectErrorToast(readyError(hook));
  const revokeWithToast = useCallback(async (id: string) => {
    const ok = await hook.revokeCode(id);
    ok && toast.success('Code revoked');
  }, [hook, toast]);
  return (
    <>
      <SectionHeader
        kicker="surface · access"
        title="codes"
        count={titleCount(hook)}
        action={<NewCodeBtn open={modals.openCreate} />}
      />
      <Intro />
      <CodeListBody
        hook={hook}
        openCreate={modals.openCreate}
        openQR={modals.openQR}
        openPreview={modals.openPreview}
        revokeCode={revokeWithToast}
      />
      <CodeCreateModalSlot
        open={modals.creating}
        editing={modals.editing}
        onClose={modals.closeAll}
        createCode={hook.createCode}
        updateQuotas={hook.updateQuotas}
      />
      <ModalSlot code={modals.qrCode} kind="qr" onClose={modals.closeAll} />
      <ModalSlot code={modals.previewCode} kind="preview" onClose={modals.closeAll} />
    </>
  );
}

function NewCodeBtn({ open }: { open: () => void }) {
  // Btn 把 onClick 调时会传 MouseEvent；openCreate(existing?) 不能把
  // 事件当成 existing 传进去（会让 modal 以为是 edit）。包一层裸调用。
  return <Btn kind="primary" onClick={() => open()}>＋ new code</Btn>;
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
  hook, openCreate, openQR, openPreview, revokeCode,
}: {
  hook: CodesHook;
  openCreate: (existing?: CodeView) => void;
  openQR: (c: CodeView) => void;
  openPreview: (c: CodeView) => void;
  revokeCode: (id: string) => Promise<void>;
}) {
  return hook.state.kind === 'loading' ? <Loading />
    : hook.state.kind === 'error' ? <ErrorMsg message={hook.state.message} />
    : (
      <CodeGrid
        codes={hook.state.codes}
        openEdit={openCreate}
        openQR={openQR}
        openPreview={openPreview}
        revokeCode={revokeCode}
      />
    );
}

function Loading() {
  return <p className="mono text-(--color-muted)">loading…</p>;
}

function ErrorMsg({ message }: { message: string }) {
  return <p className="mono text-(--color-accent)">{message}</p>;
}

function CodeGrid({
  codes, openEdit, openQR, openPreview, revokeCode,
}: {
  codes: readonly CodeView[];
  openEdit: (existing?: CodeView) => void;
  openQR: (c: CodeView) => void;
  openPreview: (c: CodeView) => void;
  revokeCode: (id: string) => Promise<void>;
}) {
  return codes.length === 0
    ? <EmptyState />
    : (
      <ul className="grid grid-cols-1 xl:grid-cols-2 gap-5" data-testid="code-list">
        {codes.map((c) => (
          <li key={c.id} data-testid={`code-row-${c.code}`}>
            <CodeCard
              code={c}
              onEdit={openEdit}
              onPreview={openPreview}
              onShowQR={openQR}
              onRevoke={(x) => void revokeCode(x.id)}
            />
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
  open, editing, onClose, createCode, updateQuotas,
}: {
  open: boolean;
  editing: CodeView | null;
  onClose: () => void;
  createCode: CodesHook['createCode'];
  updateQuotas: CodesHook['updateQuotas'];
}) {
  const toast = useToast();
  const onCreate = useCallback(async (input: Parameters<CodesHook['createCode']>[0]) => {
    const ok = await createCode(input);
    ok && toast.success(`Code ${input.code} created`);
    onClose();
  }, [createCode, onClose, toast]);
  const onUpdateQuotas = useCallback(
    async (id: string, input: Parameters<CodesHook['updateQuotas']>[1]) => {
      const ok = await updateQuotas(id, input);
      ok && toast.success('Quotas updated');
      onClose();
    }, [updateQuotas, onClose, toast]);
  return open ? (
    <CodeCreateModal
      existing={editing}
      onClose={onClose}
      onCreate={onCreate}
      onUpdateQuotas={onUpdateQuotas}
    />
  ) : null;
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

