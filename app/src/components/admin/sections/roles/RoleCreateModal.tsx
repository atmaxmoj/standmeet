// RoleCreateModal —— /admin/roles 创建 modal。从 RolesSection.tsx 拆出守
// max-lines。RoleCreateModalShell 拆 inputs；RoleField / Dropdown /
// MultiSelect 三个原子。

'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { ProviderSelect } from '@/components/admin/atoms/ProviderSelect';
import { useMCPServers } from '@/lib/admin/use-mcp-servers';
import { usePrompts, type PromptView } from '@/lib/admin/use-prompts';
import type { RoleView, WriteRoleInput } from '@/lib/admin/use-roles';
import { useSkills, type SkillView } from '@/lib/admin/use-skills';
import { useToast } from '@/lib/ui/toast';

export function RoleCreateModal({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (input: WriteRoleInput) => Promise<RoleView | null>;
}) {
  const prompts = usePrompts();
  const skills = useSkills();
  const mcp = useMCPServers();
  return (
    <RoleCreateModalShell
      prompts={prompts.prompts}
      skills={skills.skills}
      mcpServers={mcp.servers}
      onClose={onClose}
      onCreate={onCreate}
    />
  );
}

function RoleCreateModalShell({
  prompts, skills, mcpServers, onClose, onCreate,
}: {
  prompts: readonly PromptView[];
  skills: readonly SkillView[];
  mcpServers: readonly { id: string; name: string }[];
  onClose: () => void;
  onCreate: (input: WriteRoleInput) => Promise<RoleView | null>;
}) {
  const t = useTranslations('adminAccess');
  const [form, setForm] = useState<WriteRoleInput>({
    name: '', description: '', greeting: '', prompt_id: null,
    provider_id: '', gas_metered: false,
    corpus_uris: [], skill_ids: [], mcp_server_ids: [],
  });
  return (
    <div
      className="fixed inset-0 bg-[var(--sm-scrim)] flex items-center justify-center z-40"
      data-testid="role-create-modal"
    >
      <div className="bg-(--color-paper) border border-(--color-rule) max-w-[680px] w-[92vw] p-7 flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
        <h2 className="font-serif text-[22px]">{t('roleCreate.title')}</h2>
        <RoleTextFields form={form} setForm={setForm} />
        <RolePromptDropdown
          prompts={prompts}
          value={form.prompt_id}
          onChange={(v) => setForm((f) => ({ ...f, prompt_id: v }))}
        />
        <RoleProviderDropdown
          value={form.provider_id}
          onChange={(v) => setForm((f) => ({ ...f, provider_id: v }))}
        />
        <RoleCorpusURIsField
          value={form.corpus_uris}
          onChange={(v) => setForm((f) => ({ ...f, corpus_uris: v }))}
        />
        <RoleMultiSelect
          label="skills"
          options={skills.map((s) => ({ id: s.id, label: s.name }))}
          value={form.skill_ids}
          onChange={(v) => setForm((f) => ({ ...f, skill_ids: v }))}
          testid="role-field-skills"
        />
        <RoleMultiSelect
          label="mcp servers"
          options={mcpServers.map((m) => ({ id: m.id, label: m.name }))}
          value={form.mcp_server_ids}
          onChange={(v) => setForm((f) => ({ ...f, mcp_server_ids: v }))}
          testid="role-field-mcp-servers"
        />
        <RoleModalFooter form={form} onClose={onClose} onCreate={onCreate} />
      </div>
    </div>
  );
}

// RoleTextFields —— 三个纯文本字段(名字 / 说明 / 招呼语)。拆出来守 shell 的 max-lines。
function RoleTextFields({
  form, setForm,
}: {
  form: WriteRoleInput;
  setForm: React.Dispatch<React.SetStateAction<WriteRoleInput>>;
}) {
  return (
    <>
      <RoleField
        label="name"
        value={form.name}
        onChange={(v) => setForm((f) => ({ ...f, name: v }))}
        placeholder="e.g. recruiter-default"
      />
      <RoleField
        label="description"
        value={form.description}
        onChange={(v) => setForm((f) => ({ ...f, description: v }))}
        placeholder="when to use this role"
      />
      <RoleField
        label="greeting"
        value={form.greeting}
        onChange={(v) => setForm((f) => ({ ...f, greeting: v }))}
        placeholder="shown on the visitor name picker — blank uses a default"
      />
    </>
  );
}

function RoleField({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{label}</span>
      <input
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px]"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`role-field-${label}`}
      />
    </label>
  );
}

function RolePromptDropdown({
  prompts, value, onChange,
}: {
  prompts: readonly PromptView[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const t = useTranslations('adminAccess');
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{t('common.prompt')}</span>
      <select
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px]"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        data-testid="role-field-prompt"
      >
        <option value="">{t('roleCreate.promptNone')}</option>
        {prompts.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </label>
  );
}

// RoleProviderDropdown —— 这个 role 走哪条 provider(空 = owner 默认那条)。
// 挂在码上的那条压过它 —— 那句话在码那一面说,这里不重复。
function RoleProviderDropdown({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('adminAccess');
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {t('common.provider')}
      </span>
      <ProviderSelect
        value={value} onChange={onChange}
        inheritLabel={t('roleCreate.providerDefault')}
        testid="role-field-provider"
      />
    </label>
  );
}

function RoleCorpusURIsField({
  value, onChange,
}: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useTranslations('adminAccess');
  const text = value.join('\n');
  const onTextChange = useCallback((next: string) => {
    onChange(next.split('\n').map((s) => s.trim()).filter((s) => s !== ''));
  }, [onChange]);
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {t('roleCreate.corpusLabel')}
      </span>
      <textarea
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[13px] font-mono min-h-[100px]"
        value={text}
        placeholder={'wiki://thinking/**\noutput://public/**\nwriting://*'}
        onChange={(e) => onTextChange(e.target.value)}
        data-testid="role-field-corpus-uris"
      />
      <span className="mono text-[9.5px] text-(--color-faint)">
        {t('common.rawDenied')}
      </span>
    </label>
  );
}

function RoleMultiSelect({
  label, options, value, onChange, testid,
}: {
  label: string;
  options: readonly { id: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  testid: string;
}) {
  const t = useTranslations('adminAccess');
  const toggle = useCallback((id: string) => {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }, [value, onChange]);
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid={testid}>
      <legend className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {label}
      </legend>
      {options.length === 0 && (
        <p className="mono text-[10.5px] text-(--color-faint) italic">{t('roleCreate.noneConfigured')}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <RoleMultiSelectChip
            key={o.id}
            option={o}
            selected={value.includes(o.id)}
            onToggle={() => toggle(o.id)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function RoleMultiSelectChip({
  option, selected, onToggle,
}: {
  option: { id: string; label: string };
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={`role-multi-${option.label}`}
      className={`mono text-[10.5px] tracking-[0.10em] uppercase px-2.5 py-1 border ${
        selected
          ? 'bg-(--color-ink) text-(--color-paper) border-(--color-ink)'
          : 'border-(--color-rule) text-(--color-muted) hover:border-(--color-ink)'
      }`}
    >
      {option.label}
    </button>
  );
}

function RoleModalFooter({
  form, onClose, onCreate,
}: {
  form: WriteRoleInput;
  onClose: () => void;
  onCreate: (input: WriteRoleInput) => Promise<RoleView | null>;
}) {
  const t = useTranslations('adminAccess');
  const toast = useToast();
  const submit = useCallback(async () => {
    const created = await onCreate(form);
    created && toast.success(`Role ${form.name} created`);
    created && onClose();
  }, [form, onCreate, onClose, toast]);
  const disabled = form.name === '';
  return (
    <div className="flex justify-end gap-3 mt-2">
      <Btn kind="ghost" onClick={onClose}>{t('common.cancel')}</Btn>
      <button
        type="button"
        data-testid="role-create-submit"
        disabled={disabled}
        onClick={() => void submit()}
        className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {t('common.create')}
      </button>
    </div>
  );
}
