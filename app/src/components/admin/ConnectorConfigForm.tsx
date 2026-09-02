// ConnectorConfigForm —— dynamically renders a config form from ConnectorEntry.fields[].
// Field types: string / select (options) / secret (password) / oauth (button).
//
// Design source: docs/design/project/admin.js ConnectorConfigForm.
// Adding a new connector only needs a new entry in the registry — the form renders itself.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { SelectField } from '@/components/atoms/SelectField';
import type { ConnectorEntry, ConnectorField } from '@/lib/admin/connector-registry';

interface Props {
  entry: ConnectorEntry;
  onCancel: () => void;
  onSave: (values: Record<string, string>) => void;
}

export function ConnectorConfigForm({ entry, onCancel, onSave }: Props) {
  const [values, setValues] = useState<Record<string, string>>(initialValues(entry.fields));
  return (
    <div className="sm-connector-modal-body">
      <FormHeader entry={entry} />
      <form
        onSubmit={(e) => { e.preventDefault(); onSave(values); }}
        className="space-y-4"
        data-testid={`connector-config-${entry.id}`}
      >
        {entry.fields.map((f) => (
          <FieldRender
            key={f.k} field={f} value={values[f.k] ?? ''}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.k]: v }))}
          />
        ))}
        <FormActions onCancel={onCancel} />
      </form>
    </div>
  );
}

function initialValues(fields: readonly ConnectorField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.k] = f.default ?? '';
  return out;
}

function FormHeader({ entry }: { entry: ConnectorEntry }) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="sm-connector-card-icon">{entry.icon}</span>
        <span className="sm-connector-card-name">{entry.name}</span>
      </div>
      <p className="sm-reading text-(--color-muted) text-[14px]">{entry.blurb}</p>
    </div>
  );
}

function FieldRender({ field, value, onChange }: {
  field: ConnectorField;
  value: string;
  onChange: (v: string) => void;
}) {
  return field.oauth ? <OauthBtn field={field} />
    : field.options ? <ConfigSelectField field={field} value={value} onChange={onChange} />
    : <TextField field={field} value={value} onChange={onChange} />;
}

function OauthBtn({ field }: { field: ConnectorField }) {
  const t = useTranslations('adminShell.connectorConfig');
  return (
    <div className="sm-field">
      <span className="sm-field-label">{field.label}</span>
      <button
        type="button" className="sm-btn sm-btn-outline mt-1 self-start"
        data-testid={`connector-field-${field.k}`}
      >
        {field.label}
      </button>
      <span className="sm-field-hint">{t('oauthHint')}</span>
    </div>
  );
}

// ConfigSelectField —— "a labeled row whose control is a dropdown" in the connector config
// form. It's not the same concept as `SelectField` (the dropdown control itself, used app-wide)
// — they used to share a name. That generic name belongs to the control; calling this one
// Config* marks it as belonging to this form (see [[vocabulary-must-not-diverge]]).
function ConfigSelectField({ field, value, onChange }: {
  field: ConnectorField;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations('adminShell.connectorConfig');
  return (
    <label className="sm-field">
      <span className="sm-field-label">{field.label}</span>
      <SelectField
        value={value} onChange={(e) => onChange(e.target.value)}
        mono
        testid={`connector-field-${field.k}`}
      >
        <option value="">{t('choose')}</option>
        {field.options!.map((o) => <option key={o} value={o}>{o}</option>)}
      </SelectField>
    </label>
  );
}

function TextField({ field, value, onChange }: {
  field: ConnectorField;
  value: string;
  onChange: (v: string) => void;
}) {
  const secret = field.secret === true;
  return (
    <label className="sm-field">
      <span className="sm-field-label">{field.label}</span>
      <input
        type={secret ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={secret ? 'new-password' : 'off'}
        className={textFieldCls(secret)}
        data-testid={`connector-field-${field.k}`}
      />
    </label>
  );
}

function textFieldCls(secret: boolean): string {
  return secret ? 'sm-field-input sm-mono' : 'sm-field-input';
}

function FormActions({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations('adminShell.connectorConfig');
  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <button
        type="button" onClick={onCancel}
        className="sm-btn sm-btn-ghost"
      >
        {t('backToCatalog')}
      </button>
      <button
        type="submit" className="sm-btn sm-btn-accent"
        data-testid="connector-config-save"
      >
        {t('connect')}
      </button>
    </div>
  );
}
