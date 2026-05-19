// CodeCreateModal —— "new code" + "edit existing code" 同一个 modal。
// existing 为 null 时调 onCreate（POST /codes）；非 null 时调 onUpdateQuotas
// （PATCH /codes/:id/quotas） —— 当前只允许改配额，code 字符串本身不让改
// （因为外部 share link 都还在）。其他字段（label / scope / tags）以后再加。
//
// e2e testid 保留：code-form / code-input / code-label / code-tags /
// code-create / code-max-sessions / code-max-turns / code-save (新增)。

'use client';

import { useCallback } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { ModalShell } from '@/components/admin/modals/ModalShell';
import { CreateCodeFields } from '@/components/admin/modals/CreateCodeFields';
import { useCodeForm } from '@/lib/admin/use-code-form';

import { codeModalLabels, dispatchSave } from '@/lib/admin/use-codes';
import type { CodeView, CreateCodeInput, QuotasInput } from '@/lib/admin/use-codes';

type Props = {
  existing: CodeView | null;
  onClose: () => void;
  onCreate: (input: CreateCodeInput) => Promise<void>;
  onUpdateQuotas: (id: string, input: QuotasInput) => Promise<void>;
};

export function CodeCreateModal({ existing, onClose, onCreate, onUpdateQuotas }: Props) {
  const form = useCodeForm(existing ?? undefined);
  const submit = useSubmit(form.toInput, existing, onCreate, onUpdateQuotas);
  const labels = codeModalLabels(existing);
  return (
    <ModalShell
      onClose={onClose}
      kicker={labels.kicker}
      title={labels.title}
      maxWidth={760}
    >
      <form
        data-testid="code-form"
        onSubmit={submit}
        className="px-7 py-6 space-y-7 max-h-[70vh] overflow-y-auto"
      >
        <CreateCodeFields form={form} editing={labels.editing} />
        <ModalFooter
          editing={labels.editing}
          disabled={form.values.label.trim() === ''}
          onClose={onClose}
        />
      </form>
    </ModalShell>
  );
}


function useSubmit(
  toInput: () => CreateCodeInput,
  existing: CodeView | null,
  onCreate: (input: CreateCodeInput) => Promise<void>,
  onUpdateQuotas: (id: string, input: QuotasInput) => Promise<void>,
) {
  return useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    await dispatchSave(existing, toInput(), onCreate, onUpdateQuotas);
  }, [toInput, existing, onCreate, onUpdateQuotas]);
}

function ModalFooter({
  editing, disabled, onClose,
}: { editing: boolean; disabled: boolean; onClose: () => void }) {
  const label = editing ? 'save quotas' : 'create code';
  const testid = editing ? 'code-save' : 'code-create';
  return (
    <div className="flex items-center justify-end gap-3 border-t border-(--color-rule) pt-4">
      <Btn kind="ghost" onClick={onClose}>cancel</Btn>
      <button
        type="submit"
        data-testid={testid}
        disabled={disabled}
        className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {label}
      </button>
    </div>
  );
}
