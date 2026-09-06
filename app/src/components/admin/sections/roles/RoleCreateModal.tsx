// RoleCreateModal —— the create modal on /admin/roles. Split out of RolesSection.tsx to
// keep it under max-lines. RoleCreateModalShell splits out the inputs; RoleField / Dropdown /
// MultiSelect are the three atoms.

'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { ProviderSelect } from '@/components/admin/atoms/ProviderSelect';
import { RoleMultiSelect } from '@/components/admin/sections/roles/RoleMultiSelect';
import { SelectField } from '@/components/atoms/SelectField';
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
      className="fixed inset-0 bg-[var(--sm-scrim)] flex items-center justify-center sm-z-modal"
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
          label={t('roles.skillsLabel')}
          options={skills.map((s) => ({ id: s.id, label: s.name }))}
          value={form.skill_ids}
          onChange={(v) => setForm((f) => ({ ...f, skill_ids: v }))}
          testid="role-field-skills"
        />
        <RoleMultiSelect
          label={t('roles.mcpServersLabel')}
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

// RoleTextFields —— the three plain-text fields (name / description / greeting). Split out
// to keep the shell under max-lines.
function RoleTextFields({
  form, setForm,
}: {
  form: WriteRoleInput;
  setForm: React.Dispatch<React.SetStateAction<WriteRoleInput>>;
}) {
  const t = useTranslations('adminAccess');
  return (
    <>
      <RoleField
        id="name"
        label={t('roleCreate.fields.name')}
        value={form.name}
        onChange={(v) => setForm((f) => ({ ...f, name: v }))}
        placeholder={t('roleCreate.namePlaceholder')}
      />
      <RoleField
        id="description"
        label={t('roleCreate.fields.description')}
        value={form.description}
        onChange={(v) => setForm((f) => ({ ...f, description: v }))}
        placeholder={t('roleCreate.descPlaceholder')}
      />
      <RoleField
        id="greeting"
        label={t('roleCreate.fields.greeting')}
        value={form.greeting}
        onChange={(v) => setForm((f) => ({ ...f, greeting: v }))}
        placeholder={t('roleCreate.greetingPlaceholder')}
      />
    </>
  );
}

function RoleField({
  id, label, value, onChange, placeholder,
}: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{label}</span>
      <input
        className="sm-field-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`role-field-${id}`}
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
      <SelectField
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        testid="role-field-prompt"
      >
        <option value="">{t('roleCreate.promptNone')}</option>
        {prompts.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </SelectField>
    </label>
  );
}

// RoleProviderDropdown —— which provider this role runs on (empty = the owner's default
// one). The one attached to a code overrides this — that's said on the code side, not
// repeated here.
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

// RoleMultiSelect now lives in its own file — the card editor needs to reuse the same
// control (F-D-9).

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
    created && toast.success(t('roles.toast.created', { name: form.name }));
    created && onClose();
  }, [form, onCreate, onClose, toast, t]);
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
