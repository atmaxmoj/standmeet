// ConnectorCredForm —— #155 区 B：从派生的 auth forms 渲通用凭据表单。owner 贴 spec → 后端按
// securitySchemes 派生 → 这里据 AuthType 渲对应字段（oauth2: client_id/secret/scope/redirect_uri +
// Connect；apikey: key + 落点提示；basic: user/pass；bearer: token）。多方案给选择器。无/不支持
// 认证 → connector-status 提示。不每个连接器手写表单。

'use client';

import { useState } from 'react';

import type { AuthField, AuthForms, AuthScheme } from '@/lib/admin/use-connector-ingest';

export function ConnectorCredForm({ auth }: { auth: AuthForms }) {
  return (
    <div data-testid="connector-cred-form" className="mt-4 border-t border-(--color-rule)/60 pt-4">
      <CredNote note={auth.note ?? ''} />
      <SchemePicker forms={auth.forms ?? []} />
    </div>
  );
}

function CredNote({ note }: { note: string }) {
  return note === ''
    ? null
    : <p data-testid="connector-status" className="mono text-[12px] text-(--color-accent)">{note}</p>;
}

function SchemePicker({ forms }: { forms: AuthScheme[] }) {
  const [scheme, setScheme] = useState('');
  const selected = forms.find((f) => f.scheme === scheme) ?? forms[0];
  return selected === undefined
    ? null
    : <SchemePickerBody forms={forms} selected={selected} onScheme={setScheme} />;
}

function SchemePickerBody({
  forms, selected, onScheme,
}: { forms: AuthScheme[]; selected: AuthScheme; onScheme: (s: string) => void }) {
  return (
    <>
      <SchemeSelectMaybe forms={forms} value={selected.scheme} onChange={onScheme} />
      <SchemeBody form={selected} />
    </>
  );
}

function SchemeSelectMaybe({
  forms, value, onChange,
}: { forms: AuthScheme[]; value: string; onChange: (s: string) => void }) {
  return forms.length <= 1 ? null : (
    <label className="block mb-3">
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        authentication
      </span>
      <select
        data-testid="connector-scheme-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent border-b border-(--color-rule) py-1.5 mono text-[12px]"
      >
        {forms.map((f) => <option key={f.scheme} value={f.scheme}>{f.scheme}</option>)}
      </select>
    </label>
  );
}

function SchemeBody({ form }: { form: AuthScheme }) {
  return (
    <div className="space-y-3">
      {form.fields.map((f) => <CredField key={f.key} field={f} />)}
      <ApiKeyHint form={form} />
      <DiscoveryHint form={form} />
      <ConnectMaybe form={form} />
    </div>
  );
}

function ApiKeyHint({ form }: { form: AuthScheme }) {
  return form.type === 'apikey' ? (
    <p className="reading-tight text-[12px] text-(--color-muted)">
      Sent in the {form.in} as <code className="mono">{form.param_name}</code>.
    </p>
  ) : null;
}

function DiscoveryHint({ form }: { form: AuthScheme }) {
  return (form.discovery_url ?? '') === '' ? null : (
    <p className="reading-tight text-[12px] text-(--color-muted)">
      Discovery: <code className="mono">{form.discovery_url}</code>
    </p>
  );
}

function ConnectMaybe({ form }: { form: AuthScheme }) {
  return form.needs_dance ? (
    <button type="button" data-testid="connector-connect-button" className="sm-btn sm-btn-solid sm-btn-sm">
      Connect →
    </button>
  ) : null;
}

function CredField({ field }: { field: AuthField }) {
  return field.type === 'scopes'
    ? <ScopeField field={field} />
    : <PlainField field={field} />;
}

function ScopeField({ field }: { field: AuthField }) {
  return (
    <div>
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        scopes
      </span>
      <div data-testid={`connector-field-${field.key}`} className="flex flex-wrap gap-1.5">
        {(field.scopes ?? []).map((s) => (
          <label key={s} className="mono text-[11px] flex items-center gap-1">
            <input type="checkbox" defaultChecked data-testid={`connector-scope-${s}`} />
            {s}
          </label>
        ))}
      </div>
    </div>
  );
}

function PlainField({ field }: { field: AuthField }) {
  const readonly = field.type === 'readonly';
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        {field.key}
      </span>
      <input
        type={field.type === 'password' ? 'password' : 'text'}
        data-testid={`connector-field-${field.key}`}
        readOnly={readonly}
        defaultValue={readonly ? '/api/admin/connectors/{id}/callback' : ''}
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-1.5 mono text-[12px]"
      />
    </label>
  );
}
