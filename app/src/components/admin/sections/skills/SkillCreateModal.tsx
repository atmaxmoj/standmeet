// SkillCreateModal — the "new skill" modal for /admin/skills. Extracted from SkillsSection so
// that file stays under the presentation line budget; the create flow (name / description /
// prompt + submit) is self-contained here.

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Btn } from '@/components/admin/atoms/Btn';
import { type CreateSkillInput } from '@/lib/admin/use-skills';
import { useReportError } from '@/lib/ui/use-report-error';
import { useToast } from '@/lib/ui/toast';

export function SkillCreateModal({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (input: CreateSkillInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const t = useTranslations('adminIntegrations.skills');
  return (
    <div
      className="fixed inset-0 bg-[var(--sm-scrim)] flex items-center justify-center sm-z-modal"
      data-testid="skill-create-modal"
    >
      <div className="bg-(--color-paper) border border-(--color-rule) max-w-[640px] w-[92vw] p-7 flex flex-col gap-4">
        <h2 className="font-serif text-[22px]">{t('modalTitle')}</h2>
        <SkillField
          id="name" label={t('fieldName')} value={name} onChange={setName}
          placeholder={t('namePlaceholder')}
        />
        <SkillField
          id="description"
          label={t('fieldDescription')}
          value={description}
          onChange={setDescription}
          placeholder={t('descriptionPlaceholder')}
        />
        <SkillPromptField value={prompt} onChange={setPrompt} />
        <SkillModalFooter
          name={name}
          description={description}
          prompt={prompt}
          onClose={onClose}
          onCreate={onCreate}
        />
      </div>
    </div>
  );
}

function SkillModalFooter({
  name, description, prompt, onClose, onCreate,
}: {
  name: string;
  description: string;
  prompt: string;
  onClose: () => void;
  onCreate: (input: CreateSkillInput) => Promise<void>;
}) {
  const toast = useToast();
  const report = useReportError();
  const t = useTranslations('adminIntegrations.skills');
  // modal: success → toast + close; failure → report + stays open, so the owner sees the error,
  // fixes it, and retries.
  const submit = useCallback(async () => {
    try {
      await onCreate({ name, description, prompt });
      toast.success(t('createdToast', { name }));
      onClose();
    } catch (e) {
      report(e);
    }
  }, [name, description, prompt, onCreate, onClose, toast, report, t]);
  const disabled = name === '' || prompt === '';
  return (
    <div className="flex justify-end gap-3 mt-2">
      <Btn kind="ghost" onClick={onClose}>{t('cancel')}</Btn>
      <button
        type="button"
        data-testid="skill-create-submit"
        disabled={disabled}
        onClick={() => void submit()}
        className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {t('create')}
      </button>
    </div>
  );
}

function SkillField({
  id, label, value, onChange, placeholder,
}: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {label}
      </span>
      <input
        className="sm-field-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`skill-field-${id}`}
      />
    </label>
  );
}

function SkillPromptField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('adminIntegrations.skills');
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {t('promptLabel')}
      </span>
      <textarea
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[13px] font-mono min-h-[180px]"
        value={value}
        placeholder={t('promptPlaceholder')}
        onChange={(e) => onChange(e.target.value)}
        data-testid="skill-field-prompt"
      />
    </label>
  );
}
