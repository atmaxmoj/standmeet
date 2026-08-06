// ProviderAddForm —— 往本子里加一条。
//
// 跟上面那张"默认那条"的表单同样的字段(preset / endpoint / model / key),多一个 label ——
// owner 自己起的名字,码和 role 的下拉里显示的就是它。选 preset 时自动填它的 base URL,
// owner 改过就不再覆盖(跟上面同一条规矩)。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import type { AIProviderPresetView } from '@/lib/api/admin';
import type { CreateProviderInput } from '@/lib/admin/use-providers';
import { endpointForPreset } from '@/lib/inference/use-presets';
import { useAction } from '@/lib/ui/use-action';

interface FormState {
  label: string;
  provider: string;
  endpoint: string;
  model: string;
  key: string;
}

function seed(presets: readonly AIProviderPresetView[]): FormState {
  const first = presets[0]?.name ?? 'anthropic';
  return {
    label: '', provider: first, endpoint: endpointForPreset(first, presets),
    model: '', key: '',
  };
}

export function ProviderAddForm({
  presets, create,
}: {
  presets: readonly AIProviderPresetView[];
  create: (input: CreateProviderInput) => Promise<unknown>;
}) {
  const t = useTranslations('adminIntegrations.providerBook');
  const [form, setForm] = useState<FormState>(() => seed(presets));
  const run = useAction();
  const submit = () => void run(
    async () => {
      await create({ ...form, label: form.label.trim(), model: form.model.trim() });
      setForm(seed(presets));
    },
    { success: t('addHeading') },
  );
  return (
    <div className="pt-4 space-y-3" data-testid="provider-add-form">
      <Kicker text={t('addHeading')} />
      <Fields form={form} setForm={setForm} presets={presets} />
      <AddButton disabled={form.label.trim() === ''} onClick={submit} label={t('add')} />
    </div>
  );
}

function Fields({
  form, setForm, presets,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  presets: readonly AIProviderPresetView[];
}) {
  const t = useTranslations('adminIntegrations.providerBook');
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label={t('label')} hint={t('labelHint')}>
        <TextInput
          testid="provider-new-label" value={form.label}
          onChange={(label) => setForm((p) => ({ ...p, label }))}
        />
      </Field>
      <Field label="provider">
        <PresetSelect
          presets={presets} value={form.provider}
          onChange={(provider) => setForm((p) => ({
            ...p, provider, endpoint: endpointForPreset(provider, presets),
          }))}
        />
      </Field>
      <Field label="endpoint">
        <TextInput
          testid="provider-new-endpoint" value={form.endpoint}
          onChange={(endpoint) => setForm((p) => ({ ...p, endpoint }))}
        />
      </Field>
      <Field label="model">
        <TextInput
          testid="provider-new-model" value={form.model}
          onChange={(model) => setForm((p) => ({ ...p, model }))}
        />
      </Field>
      <Field label="api key">
        <TextInput
          testid="provider-new-key" value={form.key} secret
          onChange={(key) => setForm((p) => ({ ...p, key }))}
        />
      </Field>
    </div>
  );
}

function PresetSelect({
  presets, value, onChange,
}: {
  presets: readonly AIProviderPresetView[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      data-testid="provider-new-provider"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 mono text-[13px]"
    >
      {presets.map((p) => (
        <option key={p.name} value={p.name}>{p.name}</option>
      ))}
    </select>
  );
}

function TextInput({
  testid, value, onChange, secret,
}: {
  testid: string; value: string; onChange: (v: string) => void; secret?: boolean;
}) {
  return (
    <input
      type={secret ? 'password' : 'text'}
      data-testid={testid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      autoComplete="off"
      className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 mono text-[13px]"
    />
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <Kicker text={hint ? `${label} · ${hint}` : label} />
      {children}
    </label>
  );
}

function AddButton({
  disabled, onClick, label,
}: { disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      data-testid="provider-new-add"
      disabled={disabled}
      onClick={onClick}
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-3 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function Kicker({ text }: { text: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
      {text}
    </div>
  );
}
