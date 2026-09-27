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
import { Chip } from '@/components/admin/atoms/Chip';
import { useCodeModalState } from '@/lib/admin/use-code-modals';
import { useCodes, type CodeView, type CodesHook } from '@/lib/admin/use-codes';
import {
  CODE_FILTERS, filterCounts, useCodeFilter, visibleCodes, type CodeFilterHook,
} from '@/lib/admin/code-filter';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function CodesSection() {
  const t = useTranslations('adminAccess');
  const hook = useCodes();
  const modals = useCodeModalState();
  const filter = useCodeFilter();
  const run = useAction();
  useEffectErrorToast(hook.error);
  // revoke is a one-click destructive action → toast on both success and failure
  // (no more silent failure: if the revoke didn't take effect, the owner must know).
  const revokeWithToast = useCallback(
    (id: string) => run(() => hook.revokeCode(id), { success: t('codes.toast.revoked') }),
    [hook, run, t],
  );
  return (
    <>
      <SectionHeader
        kicker={t('codes.kicker')}
        slug="codes"
        count={titleCount(hook, t)}
        action={<NewCodeBtn open={modals.openCreate} />}
      />
      <Intro />
      <CodeFilterRow codes={hook.codes} filter={filter} />
      <CodeListBody
        hook={hook}
        filter={filter}
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

type Translator = ReturnType<typeof useTranslations>;

function titleCount(hook: CodesHook, t: Translator): string {
  return hook.status === 'ready'
    ? t('codes.count', { active: countActive(hook.codes), total: hook.codes.length })
    : '';
}

function countActive(codes: readonly CodeView[]): number {
  return filterCounts(codes, Date.now()).active;
}

// CodeFilterRow —— status chips (each with its count) + a search over code and label.
function CodeFilterRow({ codes, filter }: { codes: readonly CodeView[]; filter: CodeFilterHook }) {
  const t = useTranslations('adminAccess');
  const counts = filterCounts(codes, Date.now());
  return (
    <div className="flex items-center gap-2 mb-6 flex-wrap" data-testid="codes-filters">
      {CODE_FILTERS.map((f) => (
        <Chip key={f} active={filter.filter === f} onClick={() => filter.setFilter(f)} testid={`codes-filter-${f}`}>
          {t(`codes.filter.${f}`)} {counts[f]}
        </Chip>
      ))}
      <input
        type="search" value={filter.query} onChange={(e) => filter.setQuery(e.target.value)}
        placeholder={t('codes.searchPlaceholder')} aria-label={t('codes.searchPlaceholder')}
        data-testid="codes-search" className="sm-field-input ml-auto max-w-[16em]"
      />
    </div>
  );
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
  hook, filter, openCreate, openQR, openPreview, revokeCode,
}: {
  hook: CodesHook;
  filter: CodeFilterHook;
  openCreate: (existing?: CodeView) => void;
  openQR: (c: CodeView) => void;
  openPreview: (c: CodeView) => void;
  revokeCode: (id: string) => Promise<void>;
}) {
  const shown = visibleCodes(hook.codes, filter.filter, filter.query, Date.now());
  // Outer pane: no codes at all. Inner pane: codes exist, none in this filter / search.
  return (
    <ListPane status={hook.status} count={hook.codes.length} empty={<EmptyState />}>
      <ListPane status={hook.status} count={shown.length} empty={<FilteredEmpty />}>
        <CodeGrid
          codes={shown}
          openEdit={openCreate}
          openQR={openQR}
          openPreview={openPreview}
          revokeCode={revokeCode}
        />
      </ListPane>
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

// FilteredEmpty —— there are codes, just none in this filter / search.
function FilteredEmpty() {
  const t = useTranslations('adminAccess');
  return (
    <p className="reading italic text-(--color-muted)" data-testid="code-list-filtered-empty">
      {t('codes.filterEmpty')}
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
  const t = useTranslations('adminAccess');
  const toast = useToast();
  const report = useReportError();
  // modal: success → toast + close; failure → report + **stay open** (it used to
  // call onClose either way, so a failure silently closed and looked like a success).
  // Let the owner see the error, fix it, and retry.
  const onCreate = useCallback(async (input: Parameters<CodesHook['createCode']>[0]) => {
    try {
      await createCode(input);
      toast.success(t('codes.toast.created', { code: input.code }));
      onClose();
    } catch (e) {
      report(e);
    }
  }, [createCode, onClose, toast, report, t]);
  const onUpdateQuotas = useCallback(
    async (id: string, input: Parameters<CodesHook['updateQuotas']>[1]) => {
      try {
        await updateQuotas(id, input);
        toast.success(t('codes.toast.quotasUpdated'));
        onClose();
      } catch (e) {
        report(e);
      }
    }, [updateQuotas, onClose, toast, report, t]);
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
