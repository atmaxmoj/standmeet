// CodeCreateModal —— "new code" modal。
// 保留 e2e 用到的 testid：code-form / code-input / code-label / code-tags / code-create。
// scope / excluded tags / suggested questions 用 form state hook 管。
// onSave 调 useCodes.createCode（async）。

'use client';

import { useCallback } from 'react';

import { Btn } from '../atoms/Btn';
import { ModalShell } from './ModalShell';
import { CreateCodeFields } from './CreateCodeFields';
import { useCodeForm } from '@/lib/admin/use-code-form';

import type { CreateCodeInput } from '@/lib/admin/use-codes';

type Props = {
  onClose: () => void;
  onSave: (input: CreateCodeInput) => Promise<void>;
};

export function CodeCreateModal({ onClose, onSave }: Props) {
  const form = useCodeForm();
  const submit = useSubmit(form.toInput, onSave);
  return (
    <ModalShell
      onClose={onClose}
      kicker="new code"
      title="gate a slice of your wiki"
      maxWidth={760}
    >
      <form
        data-testid="code-form"
        onSubmit={submit}
        className="px-7 py-6 space-y-7 max-h-[70vh] overflow-y-auto"
      >
        <CreateCodeFields form={form} />
        <ModalFooter disabled={form.values.label.trim() === ''} onClose={onClose} />
      </form>
    </ModalShell>
  );
}

function useSubmit(
  toInput: () => CreateCodeInput,
  onSave: (input: CreateCodeInput) => Promise<void>,
) {
  return useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(toInput());
  }, [toInput, onSave]);
}

function ModalFooter({ disabled, onClose }: { disabled: boolean; onClose: () => void }) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-(--color-rule) pt-4">
      <Btn kind="ghost" onClick={onClose}>cancel</Btn>
      <button
        type="submit"
        data-testid="code-create"
        disabled={disabled}
        className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        create code
      </button>
    </div>
  );
}
