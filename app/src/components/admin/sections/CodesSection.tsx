// CodesSection —— the design-spec version of /admin/codes.
// SectionHeader + intro copy + a grid of CodeCard. "+ new code" opens CodeCreateModal.
// Modal save calls useCodes.createCode; the QR / Preview modals are wired in too.

'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { CodeCard } from '@/components/admin/sections/codes/CodeCard';
import { CodeCreateModal } from '@/components/admin/modals/CodeCreateModal';
import { CodeQRModal } from '@/components/admin/modals/CodeQRModal';
import { VisitorPreviewModal } from '@/components/admin/modals/VisitorPreviewModal';
import { ListPane } from '@/components/admin/ListPane';
import { useCodeModalState } from '@/lib/admin/use-code-modals';
import { useCodes, type CodeView, type CodesHook } from '@/lib/admin/use-codes';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function CodesSection() {
  const hook = useCodes();
  const modals = useCodeModalState();
  const run = useAction();
  useEffectErrorToast(hook.error);
  // revoke is a one-click destructive action → toast on both success and failure
  // (no more silent failure: if the revoke didn't take effect, the owner must know).
  const revokeWithToast = useCallback(
    (id: string) => run(() => hook.revokeCode(id), { success: 'Code revoked' }),
    [hook, run],
  );
  return (
    <>
      <SectionHeader
        kicker="access · codes"
        slug="codes"
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
  const t = useTranslations('adminAccess');
  // Btn's onClick passes a MouseEvent; openCreate(existing?) must not receive that
  // event as `existing` (it would make the modal think this is an edit). Wrap it in
  // a bare call.
  return <Btn kind="solid" onClick={() => open()}>{t('codes.new')}</Btn>;
}

function titleCount(hook: CodesHook): string {
  return hook.status === 'ready'
    ? `${countActive(hook.codes)} active · ${hook.codes.length} total`
    : '';
}

function countActive(codes: readonly CodeView[]): number {
  return codes.filter((c) => c.status === 'active').length;
}

function Intro() {
  const t = useTranslations('adminAccess');
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      {t('codes.intro')}
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
  return (
    <ListPane status={hook.status} count={hook.codes.length} empty={<EmptyState />}>
      <CodeGrid
        codes={hook.codes}
        openEdit={openCreate}
        openQR={openQR}
        openPreview={openPreview}
        revokeCode={revokeCode}
      />
    </ListPane>
  );
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
  return (
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
  const t = useTranslations('adminAccess');
  return (
    <p className="reading italic text-(--color-muted)" data-testid="code-list">
      {t('codes.empty')}
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
  const report = useReportError();
  // modal: success → toast + close; failure → report + **stay open** (it used to
  // call onClose either way, so a failure silently closed and looked like a success).
  // Let the owner see the error, fix it, and retry.
  const onCreate = useCallback(async (input: Parameters<CodesHook['createCode']>[0]) => {
    try {
      await createCode(input);
      toast.success(`Code ${input.code} created`);
      onClose();
    } catch (e) {
      report(e);
    }
  }, [createCode, onClose, toast, report]);
  const onUpdateQuotas = useCallback(
    async (id: string, input: Parameters<CodesHook['updateQuotas']>[1]) => {
      try {
        await updateQuotas(id, input);
        toast.success('Quotas updated');
        onClose();
      } catch (e) {
        report(e);
      }
    }, [updateQuotas, onClose, toast, report]);
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
